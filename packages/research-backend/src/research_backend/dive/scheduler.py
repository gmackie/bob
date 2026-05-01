"""APScheduler-based poller for queued dives + stale-worker reaper.

Task 3.7 of the academic-research-buddy implementation plan. Wires two
recurring jobs into the FastAPI app lifecycle:

* ``dive-poller`` — every ``DIVE_POLL_INTERVAL_SECONDS`` (default 2s),
  claim one ``graph_exploration`` row with ``status='queued'`` using
  ``SELECT ... FOR UPDATE SKIP LOCKED`` and hand it to :func:`run_dive`.
  The SKIP LOCKED is defense-in-depth — :func:`run_dive` already does
  its own ``queued -> running`` compare-and-swap — but it prevents two
  parallel pollers from even reading the same row.
* ``dive-reaper`` — every ``DIVE_REAP_INTERVAL_SECONDS`` (default 5min),
  mark ``status='running'`` rows whose ``started_at`` is older than
  ``DIVE_STALE_THRESHOLD_MINUTES`` (default 30min) as ``status='error'``
  with a ``stale_worker`` ``error_md``. Keeps the queue visible-by-UI
  even if a worker process is killed mid-dive.

The scheduler can be disabled via ``DIVE_SCHEDULER_ENABLED=false`` for
tests and for one-off CLI runs.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import text

from research_backend.dive.worker import run_dive

logger = logging.getLogger(__name__)

__all__ = [
    "DiveScheduler",
    "poll_once",
    "reap_stale_once",
    "POLL_INTERVAL_SECONDS",
    "REAP_INTERVAL_SECONDS",
    "STALE_THRESHOLD_MINUTES",
]


POLL_INTERVAL_SECONDS = float(os.getenv("DIVE_POLL_INTERVAL_SECONDS", "2"))
REAP_INTERVAL_SECONDS = float(os.getenv("DIVE_REAP_INTERVAL_SECONDS", "300"))
STALE_THRESHOLD_MINUTES = int(os.getenv("DIVE_STALE_THRESHOLD_MINUTES", "30"))


_VALID_VAULT_SCHEMAS = frozenset({"research_vault", "personal_vault"})


async def poll_once(
    session_factory: Callable[[], AbstractContextManager[Any]],
) -> int:
    """Claim one queued dive (SKIP LOCKED) and run it.

    Returns ``1`` if a dive was claimed and :func:`run_dive` was
    invoked, ``0`` if the queue was empty (or the claim fell through).

    The claim itself is a short synchronous DB hop — we only open the
    session for long enough to read the candidate id, then close it and
    hand the id to :func:`run_dive`, which owns its own session
    lifecycle for the duration of the dive.
    """
    exploration_id: Any = None
    vault_schema = "research_vault"

    try:
        with session_factory() as session:
            row = session.execute(
                text(
                    """
                    SELECT id, meta
                      FROM graph_exploration
                     WHERE status = 'queued'
                     ORDER BY id
                     FOR UPDATE SKIP LOCKED
                     LIMIT 1
                    """
                )
            ).first()
            if row is None:
                return 0
            exploration_id = row.id
            meta = row.meta if isinstance(row.meta, dict) else {}
            candidate_schema = meta.get("vault_schema")
            if (
                isinstance(candidate_schema, str)
                and candidate_schema in _VALID_VAULT_SCHEMAS
            ):
                vault_schema = candidate_schema
            # Commit (or simply close) to release the SKIP LOCKED lock;
            # run_dive's own CAS UPDATE will re-acquire the row and
            # flip status='running'.
            session.commit()
    except Exception:
        logger.exception("dive-poller: failed to claim a queued row")
        return 0

    if exploration_id is None:
        return 0

    try:
        await run_dive(
            exploration_id=exploration_id,
            session_factory=session_factory,
            vault_schema=vault_schema,
        )
    except Exception:
        logger.exception(
            "dive-poller: run_dive failed for exploration_id=%s", exploration_id
        )
    return 1


async def reap_stale_once(
    session_factory: Callable[[], AbstractContextManager[Any]],
) -> int:
    """Mark running dives older than the stale threshold as errored.

    Returns the number of rows reaped.

    Using ``started_at`` as the staleness signal — :func:`run_dive`
    sets it in the same UPDATE that flips ``queued -> running``, so it
    is always populated for rows in the ``running`` state. The threshold
    is pulled from :data:`STALE_THRESHOLD_MINUTES` at call time (not
    cached at import) so tests can monkeypatch it.
    """
    try:
        with session_factory() as session:
            result = session.execute(
                text(
                    """
                    UPDATE graph_exploration
                       SET status = 'error',
                           error_md = 'stale_worker: dive exceeded '
                               || :threshold || ' minutes without completing',
                           finished_at = NOW()
                     WHERE status = 'running'
                       AND started_at IS NOT NULL
                       AND started_at < NOW() - make_interval(mins => :threshold)
                    """
                ),
                {"threshold": STALE_THRESHOLD_MINUTES},
            )
            session.commit()
            reaped = int(result.rowcount or 0)
    except Exception:
        logger.exception("dive-reaper: failed to reap stale dives")
        return 0

    if reaped:
        logger.warning(
            "dive-reaper: marked %d stale running dives as errored (threshold=%dmin)",
            reaped,
            STALE_THRESHOLD_MINUTES,
        )
    return reaped


class DiveScheduler:
    """Wraps :class:`AsyncIOScheduler` for app lifecycle management.

    Two jobs are registered on :meth:`start`:

    * ``dive-poller`` — ``poll_once`` at ``POLL_INTERVAL_SECONDS``
    * ``dive-reaper`` — ``reap_stale_once`` at ``REAP_INTERVAL_SECONDS``

    Both use ``max_instances=1`` + ``coalesce=True`` so a slow tick
    doesn't cause jobs to pile up behind it.
    """

    def __init__(
        self,
        session_factory: Callable[[], AbstractContextManager[Any]],
        *,
        enabled: bool = True,
    ) -> None:
        self.session_factory = session_factory
        self.enabled = enabled
        self._scheduler: AsyncIOScheduler | None = None

    def start(self) -> None:
        """Build and start the AsyncIOScheduler (no-op if disabled)."""
        if not self.enabled:
            logger.info("DiveScheduler disabled (DIVE_SCHEDULER_ENABLED=false)")
            return
        if self._scheduler is not None:
            logger.debug("DiveScheduler.start: already running, skipping")
            return
        scheduler = AsyncIOScheduler()

        async def _run_poll() -> None:
            await poll_once(self.session_factory)

        async def _run_reap() -> None:
            await reap_stale_once(self.session_factory)

        scheduler.add_job(
            _run_poll,
            "interval",
            seconds=POLL_INTERVAL_SECONDS,
            id="dive-poller",
            max_instances=1,
            coalesce=True,
        )
        scheduler.add_job(
            _run_reap,
            "interval",
            seconds=REAP_INTERVAL_SECONDS,
            id="dive-reaper",
            max_instances=1,
            coalesce=True,
        )
        scheduler.start()
        self._scheduler = scheduler
        logger.info(
            "DiveScheduler started (poll=%ss, reap=%ss, stale_threshold=%dmin)",
            POLL_INTERVAL_SECONDS,
            REAP_INTERVAL_SECONDS,
            STALE_THRESHOLD_MINUTES,
        )

    def shutdown(self) -> None:
        """Shut down the scheduler if running. Idempotent."""
        if self._scheduler is None:
            return
        try:
            self._scheduler.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            logger.exception("DiveScheduler: error during shutdown")
        self._scheduler = None

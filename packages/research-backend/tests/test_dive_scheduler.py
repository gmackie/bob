"""Tests for :mod:`research_backend.dive.scheduler`.

Unit tests — no real DB, no real running scheduler polling the queue.
We monkeypatch :func:`research_backend.dive.scheduler.run_dive` at the
scheduler import site so ``poll_once`` exercises the claim SQL without
needing the full dive pipeline.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Any

import pytest

from research_backend.dive import scheduler as scheduler_module
from research_backend.dive.scheduler import (
    DiveScheduler,
    poll_once,
    reap_stale_once,
)

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows: list[Any] | None = None, rowcount: int = 0) -> None:
        self._rows = rows or []
        self.rowcount = rowcount

    def first(self) -> Any:
        return self._rows[0] if self._rows else None


class _Row:
    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeSession:
    """Scripted session with substring-matched SQL responses."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.responses: list[tuple[str, _FakeResult]] = []
        self.commits = 0

    def add_response(self, fragment: str, result: _FakeResult) -> None:
        self.responses.append((fragment.lower(), result))

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        sql = str(stmt)
        self.calls.append((sql, dict(params or {})))
        lower = sql.lower()
        for fragment, result in self.responses:
            if fragment in lower:
                return result
        return _FakeResult()

    def commit(self) -> None:
        self.commits += 1

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *args: Any) -> None:
        return None


def _session_factory_from(session: FakeSession):
    """Build a context-manager-yielding session_factory that returns *session*."""

    @contextmanager
    def factory():  # type: ignore[no-untyped-def]
        yield session

    return factory


# ---------------------------------------------------------------------------
# poll_once
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_poll_once_empty_queue_returns_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No queued rows → poll_once returns 0 and does NOT call run_dive."""
    run_dive_calls: list[dict[str, Any]] = []

    async def _fake_run_dive(**kwargs: Any) -> None:
        run_dive_calls.append(kwargs)

    monkeypatch.setattr(scheduler_module, "run_dive", _fake_run_dive)

    session = FakeSession()
    # No response registered for the SELECT → _FakeResult() with no rows.
    factory = _session_factory_from(session)

    result = await poll_once(factory)

    assert result == 0
    assert run_dive_calls == []


@pytest.mark.asyncio
async def test_poll_once_claims_queued_row_runs_dive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A queued row is claimed and handed to run_dive with the right args."""
    run_dive_calls: list[dict[str, Any]] = []

    async def _fake_run_dive(**kwargs: Any) -> None:
        run_dive_calls.append(kwargs)

    monkeypatch.setattr(scheduler_module, "run_dive", _fake_run_dive)

    exp_id = uuid.uuid4()
    session = FakeSession()
    session.add_response(
        "for update skip locked",
        _FakeResult(rows=[_Row(id=exp_id, meta=None)]),
    )
    factory = _session_factory_from(session)

    result = await poll_once(factory)

    assert result == 1
    assert len(run_dive_calls) == 1
    kwargs = run_dive_calls[0]
    assert kwargs["exploration_id"] == exp_id
    assert kwargs["session_factory"] is factory
    assert kwargs["vault_schema"] == "research_vault"
    # Claim query released its lock with a commit.
    assert session.commits >= 1


@pytest.mark.asyncio
async def test_poll_once_uses_vault_schema_from_meta(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """meta.vault_schema='personal_vault' flows through to run_dive."""
    run_dive_calls: list[dict[str, Any]] = []

    async def _fake_run_dive(**kwargs: Any) -> None:
        run_dive_calls.append(kwargs)

    monkeypatch.setattr(scheduler_module, "run_dive", _fake_run_dive)

    exp_id = uuid.uuid4()
    session = FakeSession()
    session.add_response(
        "for update skip locked",
        _FakeResult(rows=[_Row(id=exp_id, meta={"vault_schema": "personal_vault"})]),
    )
    factory = _session_factory_from(session)

    result = await poll_once(factory)

    assert result == 1
    assert run_dive_calls[0]["vault_schema"] == "personal_vault"


@pytest.mark.asyncio
async def test_poll_once_defaults_vault_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No meta → run_dive called with default vault_schema='research_vault'."""
    run_dive_calls: list[dict[str, Any]] = []

    async def _fake_run_dive(**kwargs: Any) -> None:
        run_dive_calls.append(kwargs)

    monkeypatch.setattr(scheduler_module, "run_dive", _fake_run_dive)

    exp_id = uuid.uuid4()
    session = FakeSession()
    session.add_response(
        "for update skip locked",
        _FakeResult(rows=[_Row(id=exp_id, meta=None)]),
    )
    factory = _session_factory_from(session)

    result = await poll_once(factory)

    assert result == 1
    assert run_dive_calls[0]["vault_schema"] == "research_vault"


@pytest.mark.asyncio
async def test_poll_once_rejects_invalid_vault_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bogus meta.vault_schema falls back to the default allowlist value."""
    run_dive_calls: list[dict[str, Any]] = []

    async def _fake_run_dive(**kwargs: Any) -> None:
        run_dive_calls.append(kwargs)

    monkeypatch.setattr(scheduler_module, "run_dive", _fake_run_dive)

    exp_id = uuid.uuid4()
    session = FakeSession()
    session.add_response(
        "for update skip locked",
        _FakeResult(
            rows=[_Row(id=exp_id, meta={"vault_schema": "'; DROP TABLE --"})]
        ),
    )
    factory = _session_factory_from(session)

    result = await poll_once(factory)

    assert result == 1
    assert run_dive_calls[0]["vault_schema"] == "research_vault"


# ---------------------------------------------------------------------------
# reap_stale_once
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reap_stale_marks_old_running_as_error() -> None:
    """UPDATE returns rowcount=3 → reap_stale_once returns 3."""
    session = FakeSession()
    session.add_response(
        "update graph_exploration",
        _FakeResult(rowcount=3),
    )
    factory = _session_factory_from(session)

    reaped = await reap_stale_once(factory)

    assert reaped == 3
    # Exactly one UPDATE issued, parameterized with the threshold.
    updates = [
        (sql, params)
        for sql, params in session.calls
        if "update graph_exploration" in sql.lower()
    ]
    assert len(updates) == 1
    _, params = updates[0]
    assert "threshold" in params
    assert params["threshold"] == scheduler_module.STALE_THRESHOLD_MINUTES
    assert session.commits >= 1


@pytest.mark.asyncio
async def test_reap_stale_does_not_touch_non_stale() -> None:
    """UPDATE rowcount=0 → reap_stale_once returns 0 without error."""
    session = FakeSession()
    session.add_response(
        "update graph_exploration",
        _FakeResult(rowcount=0),
    )
    factory = _session_factory_from(session)

    reaped = await reap_stale_once(factory)

    assert reaped == 0


@pytest.mark.asyncio
async def test_reap_stale_swallows_db_errors() -> None:
    """A broken session should not bubble — reaper returns 0 and logs."""

    class BoomSession:
        def __enter__(self) -> "BoomSession":
            return self

        def __exit__(self, *args: Any) -> None:
            return None

        def execute(self, *_: Any, **__: Any) -> Any:
            raise RuntimeError("connection refused")

        def commit(self) -> None:
            pass

    @contextmanager
    def factory():  # type: ignore[no-untyped-def]
        yield BoomSession()

    reaped = await reap_stale_once(factory)
    assert reaped == 0


# ---------------------------------------------------------------------------
# DiveScheduler lifecycle
# ---------------------------------------------------------------------------


def _noop_factory():  # type: ignore[no-untyped-def]
    @contextmanager
    def factory():  # type: ignore[no-untyped-def]
        yield FakeSession()

    return factory


def test_scheduler_disabled_does_not_start() -> None:
    """enabled=False → start() is a no-op and _scheduler stays None."""
    sched = DiveScheduler(_noop_factory(), enabled=False)
    sched.start()
    assert sched._scheduler is None
    # shutdown on a disabled scheduler must also be a no-op.
    sched.shutdown()


@pytest.mark.asyncio
async def test_scheduler_start_schedules_both_jobs() -> None:
    """enabled=True → after start(), both dive-poller and dive-reaper exist.

    ``AsyncIOScheduler.start`` requires a running event loop, hence this
    test (and the others touching .start()) are async.
    """
    sched = DiveScheduler(_noop_factory(), enabled=True)
    try:
        sched.start()
        assert sched._scheduler is not None
        jobs = sched._scheduler.get_jobs()
        job_ids = {job.id for job in jobs}
        assert job_ids == {"dive-poller", "dive-reaper"}
    finally:
        sched.shutdown()


@pytest.mark.asyncio
async def test_scheduler_shutdown_is_idempotent() -> None:
    """Calling shutdown twice must not raise."""
    sched = DiveScheduler(_noop_factory(), enabled=True)
    sched.start()
    sched.shutdown()
    sched.shutdown()  # second call: no-op
    assert sched._scheduler is None


@pytest.mark.asyncio
async def test_scheduler_double_start_is_safe() -> None:
    """Starting an already-started scheduler does not stack more jobs."""
    sched = DiveScheduler(_noop_factory(), enabled=True)
    try:
        sched.start()
        first = sched._scheduler
        sched.start()
        assert sched._scheduler is first
        assert {j.id for j in sched._scheduler.get_jobs()} == {
            "dive-poller",
            "dive-reaper",
        }
    finally:
        sched.shutdown()

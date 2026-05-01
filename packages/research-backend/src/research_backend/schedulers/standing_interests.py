"""Standing-interests scheduler tick.

One-shot driver for :func:`tick` — invoked by a systemd timer (or the
CLI in Task 6.3). Given a per-vault session factory, it:

1. Picks up to ``batch_size`` ``standing_interest`` rows that are enabled
   and due (``last_run_at IS NULL`` OR ``last_run_at + cadence < now()``).
2. For each interest, acquires a Postgres transactional advisory lock
   keyed on ``hash(schema, interest_id)`` so two concurrent ticks for
   the same interest collapse to one.
3. Queries OpenAlex ``works_since(cursor, query_terms)``, upserts each
   hit into ``{schema}.sources``, and inserts a row into
   ``{schema}.findings_inbox`` for any hit not already present.
4. Advances ``last_run_at`` and (on non-empty results) the publication-
   date watermark stored in ``last_cursor``.
5. On exception, parses/increments a ``[n=X]`` error prefix in
   ``last_error`` (persisted across ticks). Three consecutive failures
   flip ``enabled = false`` — a schema compromise: the design called out
   an ``error_count`` column but Task 1.2 shipped the table without one,
   so we encode the counter in ``last_error``. Bigger schema change is
   out of scope for 6.1.

Design notes
------------
* **Async bridging.** ``works_since`` is async. ``tick`` is sync (CLI
  will call it). We bridge with ``asyncio.run`` around the single
  HTTP-bound coroutine — the scheduler is not long-running, no event
  loop to share.
* **Per-interest commit.** Each interest is processed in its own
  advisory-lock transaction. A failure on interest N does not lose
  the inbox rows written for interests 0..N-1.
* **Scoring.** The design called for cosine(query_embedding, title+abstract)
  but ``standing_interest`` has no ``query_embedding`` column today;
  we write ``score = NULL`` and let the dashboard surface every hit.
* **Source upsert.** ``research_backend.s2.ingest.upsert_s2_paper``
  expects an S2-shaped dict. OpenAlex works have a different shape, so
  we keep the upsert local via parameterised SQL on ``{schema}.sources``
  (content_hash keyed off OpenAlex id). Hits without a resolvable
  external id are skipped — we need a Source row to hang the inbox
  entry off.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import traceback
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from research_backend.db_models.buddy import build_vault_buddy_models
from research_backend.openalex import redact_secrets, works_since

logger = logging.getLogger(__name__)

__all__ = ["tick"]


_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})

# Max consecutive errors before an interest is auto-disabled.
_ERROR_DISABLE_THRESHOLD = 3

# Pattern extracting the cross-tick error counter from ``last_error``.
# Shape: ``[n=<int>] <free-form text>``.
_ERROR_PREFIX_RE = re.compile(r"^\[n=(\d+)\]")

# OpenAlex per-call limits. Keep polls cheap; the dashboard can trigger
# on-demand queries for deeper exploration.
_OPENALEX_MAX_RESULTS = 50
_OPENALEX_PER_PAGE = 25


def _advisory_lock_key(schema: str, interest_id: Any) -> int:
    """Stable signed 64-bit int key for ``pg_try_advisory_xact_lock``.

    Postgres advisory-lock keys are ``bigint``; we SHA-256 the tuple,
    take the first 8 bytes, interpret as signed big-endian.
    """
    raw = f"{schema}:{interest_id}".encode()
    digest = hashlib.sha256(raw).digest()[:8]
    value = int.from_bytes(digest, "big", signed=True)
    return value


def _parse_error_count(last_error: str | None) -> int:
    if not last_error:
        return 0
    match = _ERROR_PREFIX_RE.match(last_error)
    if not match:
        return 0
    try:
        return int(match.group(1))
    except ValueError:
        return 0


def _author_string(authorships: list[Any] | None) -> str | None:
    """Join OpenAlex authorships into ``"First, Second, …"``.

    OpenAlex ``authorships`` is a list of dicts with ``author.display_name``.
    Returns ``None`` when nothing usable is present.
    """
    if not authorships:
        return None
    names: list[str] = []
    for item in authorships:
        if not isinstance(item, dict):
            continue
        author = item.get("author")
        if not isinstance(author, dict):
            continue
        name = author.get("display_name")
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    if not names:
        return None
    return ", ".join(names)


def _parse_publication_date(value: str | None) -> datetime | None:
    """Parse an OpenAlex ``publication_date`` (``YYYY-MM-DD``) to a UTC datetime."""
    if not value:
        return None
    try:
        dt = datetime.strptime(value, "%Y-%m-%d")
    except (TypeError, ValueError):
        return None
    return dt.replace(tzinfo=timezone.utc)


def _normalize_openalex_work(work: dict[str, Any]) -> dict[str, Any] | None:
    """Project an OpenAlex work into a ``{schema}.sources`` row dict.

    Returns ``None`` if the work has no stable external id (we need one
    to anchor the ``(kind, external_id)`` unique index and to compute a
    dedup ``content_hash``).
    """
    openalex_id = work.get("id")
    if not isinstance(openalex_id, str) or not openalex_id:
        return None
    title = work.get("title") or "(untitled)"
    abstract = work.get("abstract") or work.get("abstract_inverted_index_reconstructed")
    body = abstract if isinstance(abstract, str) else ""
    doi = work.get("doi") if isinstance(work.get("doi"), str) else None
    source_ts = _parse_publication_date(work.get("publication_date"))
    authorships = work.get("authorships")
    author = _author_string(authorships if isinstance(authorships, list) else None)
    # DOI is the stronger dedup signal when present, else fall back to the
    # OpenAlex id. Matches the pattern in ``research_backend.s2.ingest``.
    seed = f"doi:{doi.strip().lower()}" if doi else f"openalex:{openalex_id}"
    content_hash = hashlib.sha256(seed.encode()).hexdigest()
    # Use the dedicated 'paper-openalex' kind (added in
    # drizzle/custom/004_source_kind_paper_openalex.sql). Previously this
    # was 'paper-s2', which is a lie — clustering and S2-keyed lookups
    # treated the row as if it had an S2 paperId, producing silent 404s
    # for every inbox-sourced paper.
    return {
        "kind": "paper-openalex",
        "external_id": openalex_id,
        "title": title,
        "body": body,
        "url": doi if doi else openalex_id,
        "author": author,
        "source_ts": source_ts,
        "content_hash": content_hash,
    }


def _upsert_openalex_source(
    session: Any, schema: str, row: dict[str, Any]
) -> int:
    """Upsert a normalized OpenAlex work into ``{schema}.sources``.

    Returns the integer ``source_id``. Mirrors
    :func:`research_backend.s2.ingest.upsert_s2_paper` but keyed off the
    OpenAlex id (not S2).
    """
    # Look up by content_hash first — catches the "same DOI, different
    # OpenAlex id" edge case (re-canonicalization).
    existing = session.execute(
        text(
            f"SELECT id FROM {schema}.sources WHERE content_hash = :h LIMIT 1"
        ),
        {"h": row["content_hash"]},
    ).first()
    if existing is not None:
        return int(existing.id)

    inserted = session.execute(
        text(
            f"""
            INSERT INTO {schema}.sources
                (kind, external_id, title, body, url, author,
                 source_ts, content_hash)
            VALUES (:kind, :external_id, :title, :body, :url, :author,
                    :source_ts, :content_hash)
            ON CONFLICT (kind, external_id) DO UPDATE
              SET title = EXCLUDED.title,
                  body = EXCLUDED.body,
                  url = EXCLUDED.url,
                  author = EXCLUDED.author,
                  source_ts = EXCLUDED.source_ts,
                  content_hash = EXCLUDED.content_hash
            RETURNING id
            """
        ),
        row,
    ).first()
    if inserted is None:
        raise RuntimeError("sources upsert returned no row; expected RETURNING id")
    return int(inserted.id)


def _parse_cursor(cursor_str: str | None) -> datetime | None:
    if not cursor_str:
        return None
    # Try ISO-8601 first, fall back to YYYY-MM-DD.
    try:
        dt = datetime.fromisoformat(cursor_str)
    except ValueError:
        try:
            dt = datetime.strptime(cursor_str, "%Y-%m-%d")
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _serialize_cursor(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.date().isoformat()


def _load_due_interests(
    session: Any, schema: str, batch_size: int
) -> list[Any]:
    """Return up to ``batch_size`` enabled+due interests, ordered by last_run_at."""
    models = build_vault_buddy_models(schema)
    StandingInterest = models["StandingInterest"]  # noqa: N806 — ORM class binding
    # `NULLS FIRST` on last_run_at picks up never-run interests first.
    stmt = text(
        f"""
        SELECT id, thread_id, label, query_terms, seed_source_ids,
               cadence_seconds, last_run_at, last_cursor, last_error,
               enabled, auto_disable_suggested
          FROM {schema}.standing_interest
         WHERE enabled = true
           AND (last_run_at IS NULL
                OR last_run_at + make_interval(secs => cadence_seconds) < now())
         ORDER BY last_run_at NULLS FIRST
         LIMIT :limit
        """
    )
    rows = session.execute(stmt, {"limit": batch_size}).all()
    # Hydrate via the ORM class so downstream code sees consistent attrs.
    out: list[Any] = []
    for r in rows:
        inst = StandingInterest()
        inst.id = r.id
        inst.thread_id = r.thread_id
        inst.label = r.label
        inst.query_terms = r.query_terms
        inst.seed_source_ids = r.seed_source_ids
        inst.cadence_seconds = r.cadence_seconds
        inst.last_run_at = r.last_run_at
        inst.last_cursor = r.last_cursor
        inst.last_error = r.last_error
        inst.enabled = r.enabled
        inst.auto_disable_suggested = r.auto_disable_suggested
        out.append(inst)
    return out


def _fetch_openalex_hits(
    cursor: datetime | None, query_terms: list[str] | None
) -> list[dict[str, Any]]:
    """Sync bridge around the async ``works_since`` coroutine."""
    async def _run() -> list[dict[str, Any]]:
        return await works_since(
            cursor=cursor,
            query_terms=query_terms,
            limit_per_page=_OPENALEX_PER_PAGE,
            max_results=_OPENALEX_MAX_RESULTS,
        )

    return asyncio.run(_run())


def _process_interest(
    session: Any,
    schema: str,
    interest: Any,
    *,
    fetch_hits: Callable[[datetime | None, list[str] | None], list[dict[str, Any]]],
) -> int:
    """Run one interest inside an already-open session.

    Returns the number of findings_inbox rows inserted. Raises on any
    unexpected error — the caller is responsible for translating the
    exception into the interest's error counter.
    """
    # Persisted publication-date watermark takes precedence; fall back to
    # ``last_run_at`` so a freshly-enabled interest without a cursor doesn't
    # re-scan the entire archive on its first run.
    cursor = _parse_cursor(interest.last_cursor) or interest.last_run_at
    query_terms = list(interest.query_terms or [])
    hits = fetch_hits(cursor, query_terms or None)

    inserted = 0
    latest_ts: datetime | None = None

    for work in hits:
        row = _normalize_openalex_work(work)
        if row is None:
            continue
        source_id = _upsert_openalex_source(session, schema, row)
        # Skip if this interest already saw this source — idempotent ticks.
        already = session.execute(
            text(
                f"""
                SELECT 1 FROM {schema}.findings_inbox
                 WHERE standing_interest_id = :iid AND source_id = :sid
                 LIMIT 1
                """
            ),
            {"iid": interest.id, "sid": source_id},
        ).first()
        if already is not None:
            if row["source_ts"] is not None and (
                latest_ts is None or row["source_ts"] > latest_ts
            ):
                latest_ts = row["source_ts"]
            continue

        session.execute(
            text(
                f"""
                INSERT INTO {schema}.findings_inbox
                    (standing_interest_id, source_id, reason_md, score, triage)
                VALUES (:iid, :sid, :reason, NULL, 'pending')
                """
            ),
            {
                "iid": interest.id,
                "sid": source_id,
                "reason": f"Matched interest: {interest.label}",
            },
        )
        inserted += 1
        if row["source_ts"] is not None and (
            latest_ts is None or row["source_ts"] > latest_ts
        ):
            latest_ts = row["source_ts"]

    # Cursor advancement: only move forward when we actually observed
    # dated hits. Empty result → cursor unchanged.
    if latest_ts is not None:
        new_cursor = _serialize_cursor(latest_ts)
    else:
        new_cursor = interest.last_cursor

    session.execute(
        text(
            f"""
            UPDATE {schema}.standing_interest
               SET last_run_at = now(),
                   last_cursor = :cursor,
                   last_error = NULL
             WHERE id = :iid
            """
        ),
        {"cursor": new_cursor, "iid": interest.id},
    )
    return inserted


def _record_interest_error(
    session: Any,
    schema: str,
    interest: Any,
    exc: BaseException,
) -> bool:
    """Persist an error bump against ``interest``; return ``True`` if disabled.

    The prior error count (if any) is parsed out of ``last_error``'s
    ``[n=X]`` prefix. We increment, write back, and — if the new count
    hits the threshold — flip ``enabled = false`` so the tick stops
    touching a broken interest. ``last_run_at`` is intentionally NOT
    advanced: we want the interest re-picked next tick so a transient
    blip can self-heal.
    """
    prior = _parse_error_count(interest.last_error)
    new_count = prior + 1
    tb = "".join(traceback.format_exception_only(type(exc), exc)).strip()
    # Scrub OpenAlex secrets before persisting to last_error. httpx's
    # HTTPStatusError includes the full request URL, which previously
    # carried api_key=... and mailto=... query params; we moved api_key to
    # a header (see openalex.py) and redact the leftovers here as
    # defense-in-depth.
    message = redact_secrets(f"[n={new_count}] {tb}")
    should_disable = new_count >= _ERROR_DISABLE_THRESHOLD

    if should_disable:
        session.execute(
            text(
                f"""
                UPDATE {schema}.standing_interest
                   SET last_error = :err,
                       enabled = false
                 WHERE id = :iid
                """
            ),
            {"err": message, "iid": interest.id},
        )
    else:
        session.execute(
            text(
                f"""
                UPDATE {schema}.standing_interest
                   SET last_error = :err
                 WHERE id = :iid
                """
            ),
            {"err": message, "iid": interest.id},
        )
    return should_disable


def tick(
    session_factory: Callable[[], AbstractContextManager[Any]],
    *,
    batch_size: int = 10,
    schema: str = "research_vault",
    fetch_hits: Callable[[datetime | None, list[str] | None], list[dict[str, Any]]]
    | None = None,
) -> dict[str, Any]:
    """Run one standing-interests tick. One-shot; does not loop.

    Parameters
    ----------
    session_factory:
        Zero-arg callable returning a context-managed SQLAlchemy/SQLModel
        session. Each interest is processed in its own session to isolate
        failures.
    batch_size:
        Cap on interests processed per tick.
    schema:
        Target vault schema (``research_vault`` or ``personal_vault``).
    fetch_hits:
        Test seam for the OpenAlex query. Defaults to
        :func:`_fetch_openalex_hits`, which runs the real async call.

    Returns
    -------
    dict
        ``{processed, hits_inserted, errors, disabled}`` — counts and
        the list of interest ids auto-disabled during this tick.
    """
    if schema not in _VALID_SCHEMAS:
        raise ValueError(f"invalid vault schema: {schema!r}")

    fetch = fetch_hits if fetch_hits is not None else _fetch_openalex_hits

    summary: dict[str, Any] = {
        "processed": 0,
        "hits_inserted": 0,
        "errors": 0,
        "disabled": [],
    }

    with session_factory() as session:
        interests = _load_due_interests(session, schema, batch_size)

    for interest in interests:
        lock_key = _advisory_lock_key(schema, interest.id)
        with session_factory() as session:
            try:
                acquired = session.execute(
                    text("SELECT pg_try_advisory_xact_lock(:key) AS got"),
                    {"key": lock_key},
                ).scalar()
                if not acquired:
                    logger.debug(
                        "standing_interests: skipping interest %s (lock held)",
                        interest.id,
                    )
                    # Release the implicit transaction so we don't hold
                    # any connection state.
                    session.rollback()
                    continue

                inserted = _process_interest(
                    session, schema, interest, fetch_hits=fetch
                )
                session.commit()
                summary["processed"] += 1
                summary["hits_inserted"] += inserted
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "standing_interests: interest %s failed", interest.id
                )
                summary["errors"] += 1
                # Roll back any partial work from the failed processing
                # so the error-bump update lands cleanly.
                try:
                    session.rollback()
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "standing_interests: rollback failed for %s",
                        interest.id,
                    )
                try:
                    disabled = _record_interest_error(
                        session, schema, interest, exc
                    )
                    session.commit()
                    if disabled:
                        summary["disabled"].append(interest.id)
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "standing_interests: failed to persist error for %s",
                        interest.id,
                    )
                    try:
                        session.rollback()
                    except Exception:  # noqa: BLE001
                        pass

    return summary

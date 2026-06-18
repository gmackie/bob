"""Tests for :mod:`research_backend.schedulers.standing_interests`.

No live Postgres — we drive the scheduler against a scripted
``FakeSession`` (pattern borrowed from ``tests/test_dive_scheduler.py``)
that matches SQL by substring and returns canned rows. OpenAlex is
replaced via the ``fetch_hits`` seam, so these tests exercise only the
scheduler's own control flow (due-check, cursor math, error bump,
advisory lock).
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from research_backend.schedulers.standing_interests import (
    _advisory_lock_key,
    _normalize_openalex_work,
    _parse_error_count,
    tick,
)


def test_normalize_openalex_work_uses_paper_openalex_kind() -> None:
    """OpenAlex works must be stored under kind='paper-openalex', not
    'paper-s2'. Historical bug: storing under 'paper-s2' caused downstream
    clustering / graph-node consumers to treat the row as an S2 paper
    and call s2.embedding(openalex_id), producing silent 404s for every
    inbox-sourced finding.
    """
    work = {
        "id": "https://openalex.org/W123",
        "title": "An OpenAlex paper",
        "abstract": "body",
        "doi": "10.1000/example",
        "publication_date": "2024-06-01",
        "authorships": [{"author": {"display_name": "A. Writer"}}],
    }
    row = _normalize_openalex_work(work)
    assert row is not None
    assert row["kind"] == "paper-openalex"
    assert row["external_id"] == "https://openalex.org/W123"

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(
        self,
        rows: list[Any] | None = None,
        scalar: Any | None = None,
    ) -> None:
        self._rows = rows or []
        self._scalar = scalar

    def first(self) -> Any:
        return self._rows[0] if self._rows else None

    def all(self) -> list[Any]:
        return list(self._rows)

    def scalar(self) -> Any:
        return self._scalar


class _Row:
    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeSession:
    """Scripted session matching SQL statements by substring."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.responses: list[tuple[str, _FakeResult | Exception]] = []
        self.commits = 0
        self.rollbacks = 0

    def add_response(
        self, fragment: str, result: _FakeResult | Exception
    ) -> None:
        self.responses.append((fragment.lower(), result))

    def execute(
        self, stmt: Any, params: dict[str, Any] | None = None
    ) -> _FakeResult:
        sql = str(stmt)
        self.calls.append((sql, dict(params or {})))
        lower = sql.lower()
        for fragment, result in self.responses:
            if fragment in lower:
                if isinstance(result, Exception):
                    raise result
                return result
        return _FakeResult()

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *args: Any) -> None:
        return None


def _factory_from(sessions: list[FakeSession]):
    """Return a session_factory that yields scripted sessions in order.

    Once exhausted, reuses the last session (so tests can add one session
    covering the whole tick without counting factory invocations).
    """
    idx = {"n": 0}

    @contextmanager
    def factory():  # type: ignore[no-untyped-def]
        i = min(idx["n"], len(sessions) - 1)
        idx["n"] += 1
        yield sessions[i]

    return factory


def _interest_row(
    *,
    interest_id: uuid.UUID | None = None,
    last_run_at: datetime | None = None,
    last_cursor: str | None = None,
    last_error: str | None = None,
    query_terms: list[str] | None = None,
    cadence_seconds: int = 7200,
) -> _Row:
    """Build a row mirroring the SELECT in ``_load_due_interests``."""
    return _Row(
        id=interest_id if interest_id is not None else uuid.uuid4(),
        thread_id=None,
        label="test-interest",
        query_terms=query_terms if query_terms is not None else ["foo"],
        seed_source_ids=[],
        cadence_seconds=cadence_seconds,
        last_run_at=last_run_at,
        last_cursor=last_cursor,
        last_error=last_error,
        enabled=True,
        auto_disable_suggested=False,
    )


def _openalex_work(
    wid: str = "W1",
    pub_date: str | None = "2025-03-01",
    title: str = "A title",
    doi: str | None = "10.1/abc",
) -> dict[str, Any]:
    return {
        "id": wid,
        "title": title,
        "publication_date": pub_date,
        "doi": doi,
        "authorships": [{"author": {"display_name": "First Author"}}],
    }


# ---------------------------------------------------------------------------
# Due-check
# ---------------------------------------------------------------------------


def test_due_check_not_yet_run() -> None:
    """An interest with ``last_run_at = NULL`` is picked up."""
    session = FakeSession()
    interest = _interest_row(last_run_at=None)
    # _load_due_interests SELECT returns our one row.
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[interest]))
    # Advisory lock granted.
    session.add_response("pg_try_advisory_xact_lock", _FakeResult(scalar=True))
    # No prior inbox rows.
    session.add_response("from research_vault.findings_inbox", _FakeResult(rows=[]))
    # Source upsert: content_hash lookup empty, then insert returns id=42.
    # The content_hash SELECT runs first; we need a distinct fragment for it.
    # (The INSERT contains "insert into research_vault.sources".)
    session.add_response(
        "where content_hash = :h", _FakeResult(rows=[])
    )
    session.add_response(
        "insert into research_vault.sources",
        _FakeResult(rows=[_Row(id=42)]),
    )
    # Update of interest.
    session.add_response(
        "update research_vault.standing_interest", _FakeResult()
    )

    factory = _factory_from([session])

    def fetch_hits(cursor, query_terms):
        return [_openalex_work()]

    summary = tick(factory, fetch_hits=fetch_hits)

    assert summary["processed"] == 1
    assert summary["hits_inserted"] == 1
    assert summary["errors"] == 0
    assert summary["disabled"] == []


def test_due_check_overdue() -> None:
    """``last_run_at + cadence < now()`` → picked up."""
    session = FakeSession()
    past = datetime.now(timezone.utc) - timedelta(hours=5)
    interest = _interest_row(last_run_at=past, cadence_seconds=3600)
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[interest]))
    session.add_response("pg_try_advisory_xact_lock", _FakeResult(scalar=True))
    session.add_response(
        "update research_vault.standing_interest", _FakeResult()
    )

    factory = _factory_from([session])
    summary = tick(factory, fetch_hits=lambda c, q: [])

    assert summary["processed"] == 1
    assert summary["hits_inserted"] == 0


def test_due_check_not_due() -> None:
    """Fresh ``last_run_at`` → filtered out by the WHERE clause → no processing.

    The SELECT in ``_load_due_interests`` uses ``last_run_at + cadence < now()``
    so a FakeSession returning zero rows for that statement is the
    expected path. We assert no OpenAlex call or downstream action.
    """
    session = FakeSession()
    # Filter returns nothing.
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[]))

    factory = _factory_from([session])

    called = {"n": 0}

    def fetch_hits(cursor, query_terms):
        called["n"] += 1
        return []

    summary = tick(factory, fetch_hits=fetch_hits)

    assert summary["processed"] == 0
    assert summary["hits_inserted"] == 0
    assert called["n"] == 0  # fetch never invoked when no interests are due


# ---------------------------------------------------------------------------
# Cursor math
# ---------------------------------------------------------------------------


def test_cursor_advance_on_hits() -> None:
    """Cursor moves to ``max(publication_date)`` of returned hits."""
    session = FakeSession()
    interest = _interest_row(last_run_at=None, last_cursor="2025-01-01")
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[interest]))
    session.add_response("pg_try_advisory_xact_lock", _FakeResult(scalar=True))
    session.add_response("from research_vault.findings_inbox", _FakeResult(rows=[]))
    session.add_response("where content_hash = :h", _FakeResult(rows=[]))
    session.add_response(
        "insert into research_vault.sources",
        _FakeResult(rows=[_Row(id=100)]),
    )
    session.add_response(
        "update research_vault.standing_interest", _FakeResult()
    )

    factory = _factory_from([session])
    # Two hits; max pub_date is 2025-03-15.
    def fetch_hits(cursor, query_terms):
        return [
            _openalex_work("W1", "2025-02-10"),
            _openalex_work("W2", "2025-03-15"),
            _openalex_work("W3", "2025-01-20"),
        ]

    summary = tick(factory, fetch_hits=fetch_hits)
    assert summary["processed"] == 1
    assert summary["hits_inserted"] == 3

    # Find the UPDATE of standing_interest and inspect the cursor value.
    updates = [
        (sql, params)
        for sql, params in session.calls
        if "update research_vault.standing_interest" in sql.lower()
        and "set last_run_at = now()" in sql.lower()
    ]
    assert len(updates) == 1
    _, params = updates[0]
    assert params["cursor"] == "2025-03-15"


def test_cursor_unchanged_on_empty() -> None:
    """Empty OpenAlex result leaves ``last_cursor`` as-is."""
    session = FakeSession()
    interest = _interest_row(last_run_at=None, last_cursor="2025-01-01")
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[interest]))
    session.add_response("pg_try_advisory_xact_lock", _FakeResult(scalar=True))
    session.add_response(
        "update research_vault.standing_interest", _FakeResult()
    )

    factory = _factory_from([session])
    summary = tick(factory, fetch_hits=lambda c, q: [])

    assert summary["processed"] == 1
    assert summary["hits_inserted"] == 0

    updates = [
        (sql, params)
        for sql, params in session.calls
        if "update research_vault.standing_interest" in sql.lower()
        and "set last_run_at = now()" in sql.lower()
    ]
    assert len(updates) == 1
    _, params = updates[0]
    assert params["cursor"] == "2025-01-01"


# ---------------------------------------------------------------------------
# Error bump / auto-disable
# ---------------------------------------------------------------------------


def test_three_errors_disables() -> None:
    """An interest already at ``[n=2]`` that fails again is disabled."""
    session = FakeSession()
    interest = _interest_row(
        last_run_at=None,
        last_error="[n=2] prior failure",
    )
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[interest]))
    session.add_response("pg_try_advisory_xact_lock", _FakeResult(scalar=True))

    # Trigger failure inside _process_interest: raise on the first
    # findings_inbox lookup. We have to let the content_hash SELECT +
    # sources INSERT succeed first to reach that point.
    session.add_response("where content_hash = :h", _FakeResult(rows=[]))
    session.add_response(
        "insert into research_vault.sources",
        _FakeResult(rows=[_Row(id=200)]),
    )
    session.add_response(
        "from research_vault.findings_inbox",
        RuntimeError("simulated DB error"),
    )
    # Error-bump UPDATE should include enabled=false.
    session.add_response(
        "update research_vault.standing_interest", _FakeResult()
    )

    factory = _factory_from([session])
    summary = tick(
        factory, fetch_hits=lambda c, q: [_openalex_work()]
    )

    assert summary["processed"] == 0
    assert summary["errors"] == 1
    assert summary["disabled"] == [interest.id]

    # Verify the persisted UPDATE has enabled = false.
    disable_updates = [
        (sql, params)
        for sql, params in session.calls
        if "update research_vault.standing_interest" in sql.lower()
        and "enabled = false" in sql.lower()
    ]
    assert len(disable_updates) == 1
    _, params = disable_updates[0]
    assert params["err"].startswith("[n=3]")


def test_error_below_threshold_keeps_enabled() -> None:
    """First failure: ``last_error`` updated, ``enabled`` unchanged."""
    session = FakeSession()
    interest = _interest_row(last_run_at=None, last_error=None)
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[interest]))
    session.add_response("pg_try_advisory_xact_lock", _FakeResult(scalar=True))
    session.add_response("where content_hash = :h", _FakeResult(rows=[]))
    session.add_response(
        "insert into research_vault.sources",
        _FakeResult(rows=[_Row(id=201)]),
    )
    session.add_response(
        "from research_vault.findings_inbox",
        RuntimeError("simulated DB error"),
    )
    session.add_response(
        "update research_vault.standing_interest", _FakeResult()
    )

    factory = _factory_from([session])
    summary = tick(
        factory, fetch_hits=lambda c, q: [_openalex_work()]
    )

    assert summary["errors"] == 1
    assert summary["disabled"] == []

    # Error-bump UPDATE must NOT include enabled=false.
    bump_updates = [
        (sql, params)
        for sql, params in session.calls
        if "update research_vault.standing_interest" in sql.lower()
        and "set last_error = :err" in sql.lower()
        and "enabled = false" not in sql.lower()
    ]
    assert len(bump_updates) == 1
    _, params = bump_updates[0]
    assert params["err"].startswith("[n=1]")


# ---------------------------------------------------------------------------
# Advisory lock contention
# ---------------------------------------------------------------------------


def test_advisory_lock_skip() -> None:
    """``pg_try_advisory_xact_lock`` returning False → interest is a no-op."""
    session = FakeSession()
    interest = _interest_row(last_run_at=None)
    session.add_response("from research_vault.standing_interest", _FakeResult(rows=[interest]))
    # Simulate contention — lock not granted.
    session.add_response("pg_try_advisory_xact_lock", _FakeResult(scalar=False))

    factory = _factory_from([session])

    called = {"n": 0}

    def fetch_hits(cursor, query_terms):
        called["n"] += 1
        return []

    summary = tick(factory, fetch_hits=fetch_hits)

    # Skipped without processing.
    assert summary["processed"] == 0
    assert summary["hits_inserted"] == 0
    assert summary["errors"] == 0
    # fetch_hits must NOT be called when the lock is held elsewhere.
    assert called["n"] == 0
    # No UPDATE of standing_interest should fire either.
    updates = [
        sql
        for sql, _ in session.calls
        if "update research_vault.standing_interest" in sql.lower()
    ]
    assert updates == []


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_advisory_lock_key_is_stable_and_schema_scoped() -> None:
    iid = uuid.UUID("00000000-0000-0000-0000-000000000001")
    k1 = _advisory_lock_key("research_vault", iid)
    k2 = _advisory_lock_key("research_vault", iid)
    k3 = _advisory_lock_key("personal_vault", iid)
    assert k1 == k2
    assert k1 != k3
    # Fits in Postgres bigint range.
    assert -(2**63) <= k1 < 2**63


def test_parse_error_count_handles_prefix_and_absence() -> None:
    assert _parse_error_count(None) == 0
    assert _parse_error_count("") == 0
    assert _parse_error_count("no prefix here") == 0
    assert _parse_error_count("[n=2] something") == 2
    assert _parse_error_count("[n=999] big") == 999

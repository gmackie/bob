"""Tests for :mod:`research_backend.dive.worker`.

All unit tests — no DB, no network, no LLM. We monkeypatch:

* ``worker.run_bfs`` — inspected for call args; returns a synthetic
  :class:`DiveResult`.
* ``worker.cluster_exploration`` — returns a synthetic cluster dict.
* ``worker.summarize_dive`` — returns a canned markdown string.
* ``worker.upsert_s2_paper`` — hands out incrementing source_ids so
  seed resolution has a predictable output.

The session is a fake that tracks every ``execute`` call so we can
assert on exactly what the orchestrator wrote to ``graph_exploration``
— status, summary_md, meta, errors_json, error_md, finished_at.
"""

from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock

import pytest

from research_backend.dive import worker as worker_module
from research_backend.dive.bfs import DiveResult
from research_backend.dive.worker import DiveError, run_dive

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows: list[Any] | None = None, rowcount: int = 0) -> None:
        self._rows = rows or []
        self.rowcount = rowcount

    def first(self) -> Any:
        return self._rows[0] if self._rows else None

    def all(self) -> list[Any]:
        return list(self._rows)


class _Row:
    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeSession:
    """Scripted session that responds to SQL fragment matches.

    A test sets ``.responses`` to a list of ``(matcher, FakeResult)``
    pairs — first matching fragment wins. Matchers are substrings
    checked case-insensitively against the SQL text. Anything unmatched
    returns an empty result with ``rowcount=0``.

    Every ``execute`` call is appended to ``.calls`` as
    ``(sql, params)`` for post-hoc assertions.
    """

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


class SessionHarness:
    """Factory that hands out a fresh :class:`FakeSession` each call.

    The harness holds a list of every session produced so tests can
    inspect every write made across the dive (claim, load, seed upsert,
    BFS edge inserts, status write, ...).
    """

    def __init__(
        self,
        *,
        claim_rowcount: int = 1,
        row: dict[str, Any] | None = None,
        metadata_rows: list[_Row] | None = None,
    ) -> None:
        self.claim_rowcount = claim_rowcount
        self.row = row
        self.metadata_rows = metadata_rows or []
        self.sessions: list[FakeSession] = []

    def _prep(self, session: FakeSession) -> None:
        # Claim UPDATE — matched by presence of "update graph_exploration" +
        # "status = 'running'". We apply claim_rowcount the first time only;
        # subsequent UPDATEs to the row (status=done / status=error) get 1.
        session.add_response(
            "set status = 'running'",
            _FakeResult(rowcount=self.claim_rowcount),
        )
        # Load row — selects from graph_exploration.
        if self.row is not None:
            load_row = _Row(
                seed=self.row.get("seed", []),
                budget_papers=self.row.get("budget_papers", 60),
                budget_seconds=self.row.get("budget_seconds", 180),
                meta=self.row.get("meta"),
            )
            session.add_response(
                "from graph_exploration",
                _FakeResult(rows=[load_row]),
            )
        # Metadata hydration query — selects from sources JOIN graph_node.
        session.add_response(
            "from research_vault.sources",
            _FakeResult(rows=list(self.metadata_rows)),
        )
        session.add_response(
            "from personal_vault.sources",
            _FakeResult(rows=list(self.metadata_rows)),
        )

    @contextmanager
    def __call__(self):  # type: ignore[no-untyped-def]
        session = FakeSession()
        self._prep(session)
        self.sessions.append(session)
        try:
            yield session
        finally:
            pass

    def find_update_status(self, status: str) -> list[dict[str, Any]]:
        """Return params of every UPDATE that set status=<status>."""
        out: list[dict[str, Any]] = []
        for session in self.sessions:
            for sql, params in session.calls:
                low = sql.lower()
                if (
                    "update graph_exploration" in low
                    and f"status = '{status}'" in low
                ):
                    out.append(params)
        return out


# ---------------------------------------------------------------------------
# Common monkeypatch helpers
# ---------------------------------------------------------------------------


def _patch_upsert(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Install a fake ``upsert_s2_paper`` returning incrementing source ids."""
    state: dict[str, Any] = {"next_id": 500, "by_s2": {}, "calls": []}

    def _fake(
        session: Any,
        vault_schema: str,
        paper: dict[str, Any],
        first_seen_exploration: uuid.UUID | None = None,
    ) -> int:
        pid = paper.get("paperId")
        state["calls"].append(pid)
        if pid in state["by_s2"]:
            return state["by_s2"][pid]
        new_id = state["next_id"]
        state["next_id"] += 1
        state["by_s2"][pid] = new_id
        return new_id

    monkeypatch.setattr(worker_module, "upsert_s2_paper", _fake)
    return state


def _patch_bfs(
    monkeypatch: pytest.MonkeyPatch,
    *,
    result: DiveResult | None = None,
    raise_exc: Exception | None = None,
) -> dict[str, Any]:
    """Install a fake ``run_bfs`` whose kwargs are captured for assertions."""
    state: dict[str, Any] = {"called": False, "kwargs": None}

    async def _fake(**kwargs: Any) -> DiveResult:
        state["called"] = True
        state["kwargs"] = kwargs
        if raise_exc is not None:
            raise raise_exc
        return result or DiveResult(
            visited_source_ids=[500, 501],
            edge_count=3,
            s2_requests_used=5,
            elapsed_seconds=1.23,
            early_terminated=False,
            termination_reason="empty_frontier",
            errors=[],
        )

    monkeypatch.setattr(worker_module, "run_bfs", _fake)
    return state


def _patch_cluster(
    monkeypatch: pytest.MonkeyPatch,
    *,
    result: dict | None = None,
    raise_exc: Exception | None = None,
) -> dict[str, Any]:
    state: dict[str, Any] = {"called": False}

    async def _fake(**_: Any) -> dict:
        state["called"] = True
        if raise_exc is not None:
            raise raise_exc
        return result or {
            "n_papers": 2,
            "n_clusters": 1,
            "noise_count": 0,
            "clusters": [
                {
                    "cluster_id": 0,
                    "size": 2,
                    "paper_source_ids": [500, 501],
                    "top_papers": [500, 501],
                }
            ],
        }

    monkeypatch.setattr(worker_module, "cluster_exploration", _fake)
    return state


def _patch_summarize(
    monkeypatch: pytest.MonkeyPatch,
    *,
    text_out: str = "# Summary\n\nStuff.",
    raise_exc: Exception | None = None,
) -> dict[str, Any]:
    state: dict[str, Any] = {"called": False, "kwargs": None}

    async def _fake(**kwargs: Any) -> str:
        state["called"] = True
        state["kwargs"] = kwargs
        if raise_exc is not None:
            raise raise_exc
        return text_out

    monkeypatch.setattr(worker_module, "summarize_dive", _fake)
    return state


def _make_s2_mock(
    *,
    paper_by_id: dict[str, dict] | None = None,
    search_results: dict[str, list[dict]] | None = None,
    embedding: dict | None = None,
) -> AsyncMock:
    """Build an AsyncMock S2 client with scripted paper/paper_search/embedding."""
    paper_by_id = paper_by_id or {}
    search_results = search_results or {}
    client = AsyncMock()
    client.disabled = False

    async def _paper(paper_id: str, fields: str = "") -> dict:
        if paper_id in paper_by_id:
            return paper_by_id[paper_id]
        return {}

    async def _paper_search(query: str, limit: int = 20, **_: Any) -> dict:
        return {"data": search_results.get(query, [])}

    async def _embedding(paper_id: str) -> dict:
        if embedding is not None:
            return embedding
        return {}

    client.paper = AsyncMock(side_effect=_paper)
    client.paper_search = AsyncMock(side_effect=_paper_search)
    client.embedding = AsyncMock(side_effect=_embedding)
    return client


def _paper(paper_id: str, doi: str | None = None) -> dict[str, Any]:
    p: dict[str, Any] = {
        "paperId": paper_id,
        "title": f"Paper {paper_id}",
        "year": 2023,
        "citationCount": 5,
        "influentialCitationCount": 1,
        "authors": [{"name": "Author"}],
    }
    if doi:
        p["externalIds"] = {"DOI": doi}
    return p


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_run_dive_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Status transitions to done with summary_md and meta populated."""
    _patch_upsert(monkeypatch)
    bfs_state = _patch_bfs(monkeypatch)
    cluster_state = _patch_cluster(monkeypatch)
    summarize_state = _patch_summarize(monkeypatch, text_out="## Done")

    exploration_id = uuid.uuid4()
    harness = SessionHarness(
        row={
            "seed": ["abc123xyz"],
            "budget_papers": 50,
            "budget_seconds": 90,
            "meta": {"focus": "recent"},
        },
        metadata_rows=[
            _Row(
                source_id=500,
                title="Seed title",
                author="Seed Author",
                source_ts=None,
                s2_paper_id="abc123xyz",
                influence_score=0.2,
            ),
            _Row(
                source_id=501,
                title="Visited title",
                author="V Author",
                source_ts=None,
                s2_paper_id="vis-1",
                influence_score=0.1,
            ),
        ],
    )
    s2 = _make_s2_mock(paper_by_id={"abc123xyz": _paper("abc123xyz")})

    await run_dive(
        exploration_id=exploration_id,
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    assert bfs_state["called"]
    assert cluster_state["called"]
    assert summarize_state["called"]

    done_updates = harness.find_update_status("done")
    assert len(done_updates) == 1
    params = done_updates[0]
    assert params["summary_md"] == "## Done"
    meta = json.loads(params["meta"])
    assert meta["edge_count"] == 3
    assert meta["termination_reason"] == "empty_frontier"
    assert meta["focus"] == "recent"
    assert meta["n_clusters"] == 1
    errors = json.loads(params["errors"])
    assert errors == []


async def test_run_dive_already_running_noops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If claim UPDATE affects 0 rows, orchestrator returns without running BFS."""
    _patch_upsert(monkeypatch)
    bfs_state = _patch_bfs(monkeypatch)
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch)

    harness = SessionHarness(claim_rowcount=0, row=None)
    s2 = _make_s2_mock()

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    assert bfs_state["called"] is False
    # No done / error UPDATEs should have been issued.
    assert harness.find_update_status("done") == []
    assert harness.find_update_status("error") == []


async def test_run_dive_no_seeds_resolved_marks_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """All seeds fail to resolve -> status=error with error_md mentioning seeds."""
    _patch_upsert(monkeypatch)
    bfs_state = _patch_bfs(monkeypatch)
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch)

    harness = SessionHarness(
        row={
            "seed": ["nonsense query that wont match", "another bad one"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    # S2 returns empty search results for every query.
    s2 = _make_s2_mock()

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    assert bfs_state["called"] is False
    err_updates = harness.find_update_status("error")
    assert len(err_updates) == 1
    assert "seed" in err_updates[0]["error_md"].lower()


async def test_run_dive_bfs_failure_marks_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """BFS raises -> status=error; error_md references the BFS failure."""
    _patch_upsert(monkeypatch)
    _patch_bfs(monkeypatch, raise_exc=RuntimeError("bfs exploded"))
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch)

    harness = SessionHarness(
        row={
            "seed": ["s2seedid"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    s2 = _make_s2_mock(paper_by_id={"s2seedid": _paper("s2seedid")})

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    err_updates = harness.find_update_status("error")
    assert len(err_updates) == 1
    assert "bfs" in err_updates[0]["error_md"].lower()


async def test_run_dive_cluster_failure_continues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Clustering raises but summarize still called; status=done with error in errors_json."""
    _patch_upsert(monkeypatch)
    _patch_bfs(monkeypatch)
    _patch_cluster(monkeypatch, raise_exc=RuntimeError("hdbscan boom"))
    summarize_state = _patch_summarize(monkeypatch, text_out="## ok anyway")

    harness = SessionHarness(
        row={
            "seed": ["s2seedid"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    s2 = _make_s2_mock(paper_by_id={"s2seedid": _paper("s2seedid")})

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    assert summarize_state["called"]
    # Summarizer should have been given an empty clusters dict.
    clusters_passed = summarize_state["kwargs"]["clusters"]
    assert (clusters_passed.get("n_clusters") or 0) == 0

    done_updates = harness.find_update_status("done")
    assert len(done_updates) == 1
    errors = json.loads(done_updates[0]["errors"])
    assert any(e.get("phase") == "cluster" for e in errors)


async def test_run_dive_summarize_failure_leaves_summary_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Summarize raises -> status=done, summary_md=NULL, error captured in errors_json."""
    _patch_upsert(monkeypatch)
    _patch_bfs(monkeypatch)
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch, raise_exc=RuntimeError("llm ded"))

    harness = SessionHarness(
        row={
            "seed": ["s2seedid"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    s2 = _make_s2_mock(paper_by_id={"s2seedid": _paper("s2seedid")})

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    done_updates = harness.find_update_status("done")
    assert len(done_updates) == 1
    params = done_updates[0]
    assert params["summary_md"] is None
    meta = json.loads(params["meta"])
    assert meta["edge_count"] == 3  # BFS stats still there
    errors = json.loads(params["errors"])
    assert any(e.get("phase") == "summarize" for e in errors)

    # No error_md because the dive is "done", not "error".
    assert harness.find_update_status("error") == []


async def test_run_dive_seed_doi_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A DOI seed routes through s2.paper with a DOI: prefix."""
    _patch_upsert(monkeypatch)
    _patch_bfs(monkeypatch)
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch)

    harness = SessionHarness(
        row={
            "seed": ["10.1038/nature12373"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    s2 = _make_s2_mock(
        paper_by_id={
            "DOI:10.1038/nature12373": _paper("s2-x", doi="10.1038/nature12373"),
        }
    )

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    # Verify s2.paper was called with DOI-prefixed id and NOT paper_search.
    call_args = [c.args for c in s2.paper.call_args_list]
    assert any("DOI:10.1038/nature12373" in args for args in call_args)
    assert s2.paper_search.await_count == 0
    assert len(harness.find_update_status("done")) == 1


async def test_run_dive_seed_s2_id_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bare alphanumeric seed hits s2.paper directly, no DOI prefix."""
    _patch_upsert(monkeypatch)
    _patch_bfs(monkeypatch)
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch)

    harness = SessionHarness(
        row={
            "seed": ["abc123"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    s2 = _make_s2_mock(paper_by_id={"abc123": _paper("abc123")})

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    call_args = [c.args for c in s2.paper.call_args_list]
    assert any("abc123" in args and "DOI:" not in str(args) for args in call_args)
    assert s2.paper_search.await_count == 0


async def test_run_dive_seed_freetext_search(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Free-text seed with whitespace routes through paper_search."""
    _patch_upsert(monkeypatch)
    _patch_bfs(monkeypatch)
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch)

    harness = SessionHarness(
        row={
            "seed": ["sleep apnea cpap"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    s2 = _make_s2_mock(
        search_results={
            "sleep apnea cpap": [{"paperId": "from-search"}],
        },
        paper_by_id={"from-search": _paper("from-search")},
    )

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    assert s2.paper_search.await_count == 1
    # And s2.paper was called to resolve the search hit into full metadata.
    call_args = [c.args for c in s2.paper.call_args_list]
    assert any("from-search" in args for args in call_args)


async def test_run_dive_persists_bfs_errors_to_errors_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """BFS result carries an errors list -> orchestrator persists to errors_json."""
    _patch_upsert(monkeypatch)
    _patch_bfs(
        monkeypatch,
        result=DiveResult(
            visited_source_ids=[500],
            edge_count=0,
            s2_requests_used=3,
            elapsed_seconds=0.5,
            early_terminated=False,
            termination_reason="empty_frontier",
            errors=[
                {"phase": "citations", "source_id": 500, "error": "boom"},
            ],
        ),
    )
    _patch_cluster(monkeypatch)
    _patch_summarize(monkeypatch)

    harness = SessionHarness(
        row={
            "seed": ["s2seedid"],
            "budget_papers": 10,
            "budget_seconds": 30,
            "meta": None,
        }
    )
    s2 = _make_s2_mock(paper_by_id={"s2seedid": _paper("s2seedid")})

    await run_dive(
        exploration_id=uuid.uuid4(),
        session_factory=harness,
        vault_schema="research_vault",
        s2=s2,
    )

    done_updates = harness.find_update_status("done")
    assert len(done_updates) == 1
    errors = json.loads(done_updates[0]["errors"])
    assert any(
        e.get("phase") == "citations" and e.get("source_id") == 500 for e in errors
    )


def test_dive_error_is_exception() -> None:
    """DiveError is a plain Exception subclass — the orchestrator raises and catches it."""
    err = DiveError("no seeds")
    assert isinstance(err, Exception)
    assert str(err) == "no seeds"

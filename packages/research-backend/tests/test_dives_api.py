"""Tests for :mod:`research_backend.routes.dives`.

All unit tests — no real DB, no engine. We mount the dives router on a
bare :class:`fastapi.FastAPI` app (skipping ``research_backend.main``
so no ``DATABASE_URL`` engine init is needed) and override
:func:`research_backend.routes.dives.get_db_session` with a scripted
:class:`FakeSession` so we can assert on exactly what the endpoints
wrote / read.
"""

from __future__ import annotations

import datetime as _dt
import json
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from research_backend.routes.dives import get_db_session
from research_backend.routes.dives import router as dives_router

# ---------------------------------------------------------------------------
# Fakes — small copy of the pattern from test_dive_worker.py
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
    """Session that dispatches on SQL fragment substring.

    Tests set ``.responses`` via :meth:`add_response`; first match wins.
    All executed statements are captured in ``.calls`` for post-hoc
    inspection.
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


# ---------------------------------------------------------------------------
# App / client factory
# ---------------------------------------------------------------------------


@pytest.fixture
def session() -> FakeSession:
    return FakeSession()


@pytest.fixture
def client(session: FakeSession) -> TestClient:
    """FastAPI TestClient bound to a minimal app that only mounts ``dives_router``.

    We deliberately avoid ``research_backend.main.create_app`` here so the
    test suite doesn't require ``DATABASE_URL`` to build a real engine —
    every route we exercise has its DB dependency overridden with a
    :class:`FakeSession`, so no engine is ever touched.
    """
    app = FastAPI()
    app.include_router(dives_router)

    def _override() -> Any:
        yield session

    app.dependency_overrides[get_db_session] = _override
    with TestClient(app) as c:
        yield c


def _valid_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "thread_id": str(uuid.uuid4()),
        "seeds": ["10.1038/nature12373"],
        "budget_papers": 60,
        "budget_seconds": 180,
        "focus": "balanced",
        "vault_schema": "research_vault",
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# POST /dives
# ---------------------------------------------------------------------------


def test_spawn_dive_returns_queued_with_uuid(
    client: TestClient, session: FakeSession
) -> None:
    body = _valid_body()
    resp = client.post("/dives", json=body)

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["status"] == "queued"
    # Round-trip parseable as a UUID.
    uuid.UUID(payload["exploration_id"])

    # Verify the INSERT was issued with the expected params.
    inserts = [
        (sql, params)
        for sql, params in session.calls
        if "insert into graph_exploration" in sql.lower()
    ]
    assert len(inserts) == 1
    _, params = inserts[0]
    assert str(params["id"]) == payload["exploration_id"]
    assert str(params["thread_id"]) == body["thread_id"]
    assert params["seed"] == body["seeds"]
    assert params["budget_papers"] == 60
    assert params["budget_seconds"] == 180
    meta = json.loads(params["meta"])
    assert meta["focus"] == "balanced"
    assert meta["vault_schema"] == "research_vault"

    assert session.commits == 1


def test_spawn_dive_validates_seeds_non_empty(client: TestClient) -> None:
    resp = client.post("/dives", json=_valid_body(seeds=[]))
    assert resp.status_code == 422


def test_spawn_dive_validates_seeds_max_length(client: TestClient) -> None:
    resp = client.post("/dives", json=_valid_body(seeds=[f"s{i}" for i in range(21)]))
    assert resp.status_code == 422


def test_spawn_dive_validates_budget_papers_in_range(client: TestClient) -> None:
    # Below the min.
    assert client.post("/dives", json=_valid_body(budget_papers=1)).status_code == 422
    # Above the max.
    assert client.post("/dives", json=_valid_body(budget_papers=500)).status_code == 422


def test_spawn_dive_validates_budget_seconds_in_range(client: TestClient) -> None:
    assert client.post("/dives", json=_valid_body(budget_seconds=1)).status_code == 422
    assert (
        client.post("/dives", json=_valid_body(budget_seconds=9000)).status_code == 422
    )


def test_spawn_dive_rejects_unknown_vault_schema(client: TestClient) -> None:
    resp = client.post("/dives", json=_valid_body(vault_schema="hacker_schema"))
    assert resp.status_code == 400
    assert "vault_schema" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# GET /dives/{id}
# ---------------------------------------------------------------------------


def test_get_dive_status_returns_404_on_missing(client: TestClient) -> None:
    resp = client.get(f"/dives/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_get_dive_status_returns_row(
    client: TestClient, session: FakeSession
) -> None:
    exp_id = uuid.uuid4()
    thread_id = uuid.uuid4()
    started = _dt.datetime(2026, 4, 19, 10, 0, 0, tzinfo=_dt.timezone.utc)
    session.add_response(
        "from graph_exploration",
        _FakeResult(
            rows=[
                _Row(
                    id=exp_id,
                    thread_id=thread_id,
                    seed=["abc"],
                    budget_papers=40,
                    budget_seconds=120,
                    status="running",
                    started_at=started,
                    finished_at=None,
                    summary_md=None,
                    meta={"focus": "recent"},
                    errors_json=None,
                    error_md=None,
                )
            ]
        ),
    )

    resp = client.get(f"/dives/{exp_id}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(exp_id)
    assert body["thread_id"] == str(thread_id)
    assert body["seed"] == ["abc"]
    assert body["budget_papers"] == 40
    assert body["budget_seconds"] == 120
    assert body["status"] == "running"
    assert body["started_at"].startswith("2026-04-19T10:00:00")
    assert body["finished_at"] is None
    assert body["summary_md"] is None
    assert body["meta"] == {"focus": "recent"}
    assert body["errors_json"] is None
    assert body["error_md"] is None


# ---------------------------------------------------------------------------
# GET /dives/{id}/results
# ---------------------------------------------------------------------------


def test_get_dive_results_returns_404_when_missing(client: TestClient) -> None:
    resp = client.get(f"/dives/{uuid.uuid4()}/results")
    assert resp.status_code == 404


def test_get_dive_results_returns_empty_when_not_done(
    client: TestClient, session: FakeSession
) -> None:
    exp_id = uuid.uuid4()
    session.add_response(
        "from graph_exploration",
        _FakeResult(
            rows=[
                _Row(
                    id=exp_id,
                    status="running",
                    summary_md=None,
                    meta={"focus": "balanced", "vault_schema": "research_vault"},
                )
            ]
        ),
    )

    resp = client.get(f"/dives/{exp_id}/results")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "running"
    assert body["papers"] == []
    assert body["clusters"] == []
    assert body["edge_counts_by_kind"] == {}

    # Crucially, no edge-count / top-k queries should have been run
    # against the vault schema since the dive isn't done.
    schema_queries = [
        sql
        for sql, _ in session.calls
        if "research_vault.graph_edge" in sql.lower()
        or "research_vault.sources" in sql.lower()
    ]
    assert schema_queries == []


def test_get_dive_results_returns_ranked_papers_when_done(
    client: TestClient, session: FakeSession
) -> None:
    exp_id = uuid.uuid4()
    # First execute is the exploration row load.
    session.add_response(
        "from graph_exploration",
        _FakeResult(
            rows=[
                _Row(
                    id=exp_id,
                    status="done",
                    summary_md="# Summary",
                    meta={
                        "focus": "balanced",
                        "vault_schema": "research_vault",
                        "cluster_summary": {
                            "clusters": [
                                {
                                    "cluster_id": 0,
                                    "size": 2,
                                    "top_papers": [501],
                                }
                            ]
                        },
                    },
                )
            ]
        ),
    )
    # Edge counts query.
    session.add_response(
        "group by kind",
        _FakeResult(
            rows=[
                _Row(kind="cites", n=5),
                _Row(kind="references", n=3),
            ]
        ),
    )
    # Top-k papers query — note these are returned already ordered because
    # FakeSession doesn't interpret ORDER BY; tests pre-sort.
    year_ts = _dt.datetime(2023, 1, 1, tzinfo=_dt.timezone.utc)
    session.add_response(
        "with involved as",
        _FakeResult(
            rows=[
                _Row(
                    source_id=500,
                    title="High-influence paper",
                    author="Alice",
                    source_ts=year_ts,
                    influence_score=0.9,
                ),
                _Row(
                    source_id=501,
                    title="Cluster top paper",
                    author="Bob",
                    source_ts=year_ts,
                    influence_score=0.5,
                ),
                _Row(
                    source_id=502,
                    title="Lower paper",
                    author="Carol",
                    source_ts=None,
                    influence_score=0.1,
                ),
            ]
        ),
    )

    resp = client.get(f"/dives/{exp_id}/results?top_k=5")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["status"] == "done"
    assert body["summary_md"] == "# Summary"

    # Papers in the order FakeSession returned them (ORDER BY is SQL-side).
    assert [p["source_id"] for p in body["papers"]] == [500, 501, 502]
    assert body["papers"][0]["title"] == "High-influence paper"
    assert body["papers"][0]["authors"] == "Alice"
    assert body["papers"][0]["year"] == 2023
    assert body["papers"][0]["influence_score"] == pytest.approx(0.9)
    # 501 appeared in a cluster's top_papers -> reason is top-cluster-paper.
    assert body["papers"][1]["reason"] == "top-cluster-paper"
    # 500 and 502 didn't -> high-influence.
    assert body["papers"][0]["reason"] == "high-influence"
    assert body["papers"][2]["reason"] == "high-influence"
    assert body["papers"][2]["year"] is None

    # Clusters summary shape preserved.
    assert body["clusters"] == [
        {"cluster_id": 0, "size": 2, "top_papers": [501]}
    ]

    # Verify top_k was passed into the query.
    top_k_params = [
        params
        for sql, params in session.calls
        if "research_vault.sources" in sql.lower()
    ]
    assert top_k_params and top_k_params[0]["top_k"] == 5


def test_get_dive_results_edge_counts_grouped_by_kind(
    client: TestClient, session: FakeSession
) -> None:
    exp_id = uuid.uuid4()
    session.add_response(
        "from graph_exploration",
        _FakeResult(
            rows=[
                _Row(
                    id=exp_id,
                    status="done",
                    summary_md=None,
                    meta={"vault_schema": "research_vault"},
                )
            ]
        ),
    )
    session.add_response(
        "group by kind",
        _FakeResult(
            rows=[
                _Row(kind="cites", n=7),
                _Row(kind="similar_embedding", n=2),
                _Row(kind="recommended_by_s2", n=4),
            ]
        ),
    )
    session.add_response(
        "with involved as",
        _FakeResult(rows=[]),
    )

    resp = client.get(f"/dives/{exp_id}/results")
    assert resp.status_code == 200
    body = resp.json()
    assert body["edge_counts_by_kind"] == {
        "cites": 7,
        "similar_embedding": 2,
        "recommended_by_s2": 4,
    }
    assert body["papers"] == []


def test_get_dive_results_defaults_vault_schema_when_meta_missing(
    client: TestClient, session: FakeSession
) -> None:
    """meta without vault_schema falls back to research_vault, not an error."""
    exp_id = uuid.uuid4()
    session.add_response(
        "from graph_exploration",
        _FakeResult(
            rows=[
                _Row(
                    id=exp_id,
                    status="done",
                    summary_md=None,
                    meta=None,  # whole meta missing
                )
            ]
        ),
    )
    session.add_response("research_vault.graph_edge", _FakeResult(rows=[]))
    session.add_response("research_vault.sources", _FakeResult(rows=[]))

    resp = client.get(f"/dives/{exp_id}/results")
    assert resp.status_code == 200
    body = resp.json()
    assert body["clusters"] == []
    assert body["edge_counts_by_kind"] == {}

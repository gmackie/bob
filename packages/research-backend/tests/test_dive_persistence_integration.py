"""Worker-to-reader regression against an explicitly isolated PostgreSQL database."""

import os
import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from research_backend.dive import worker
from research_backend.dive.bfs import DiveResult
from research_backend.routes.dives import SpawnDiveRequest, get_dive_results, spawn_dive

URL = os.environ.get("RESEARCH_TEST_DATABASE_URL")
if os.environ.get("RESEARCH_TEST_REQUIRE_DB") == "1" and not URL:
    raise RuntimeError("RESEARCH_TEST_DATABASE_URL is required for integration acceptance")
pytestmark = pytest.mark.skipif(not URL, reason="requires isolated RESEARCH_TEST_DATABASE_URL")


@pytest.fixture
def sessions():
    engine = create_engine(URL)
    with engine.begin() as c:
        c.execute(
            text("""CREATE TABLE graph_exploration (
          id uuid primary key, thread_id uuid, seed text[], budget_papers integer,
          budget_seconds integer, status text, meta jsonb, errors_json jsonb,
          error_md text, summary_md text, started_at timestamptz, finished_at timestamptz)""")
        )
        for vault in ("research_vault", "personal_vault"):
            c.execute(text(f"CREATE SCHEMA {vault}"))
            c.execute(
                text(
                    f"CREATE TABLE {vault}.sources "
                    "(id bigint primary key, title text, author text, source_ts timestamptz)"
                )
            )
            c.execute(
                text(
                    f"CREATE TABLE {vault}.graph_node "
                    "(source_id bigint, s2_paper_id text, influence_score float)"
                )
            )
            c.execute(
                text(
                    f"CREATE TABLE {vault}.graph_edge "
                    "(from_source_id bigint, to_source_id bigint, discovered_in uuid, kind text)"
                )
            )
    try:
        yield sessionmaker(engine)
    finally:
        with engine.begin() as c:
            c.execute(text("DROP TABLE graph_exploration"))
            for vault in ("research_vault", "personal_vault"):
                c.execute(text(f"DROP SCHEMA {vault} CASCADE"))
        engine.dispose()


@pytest.mark.parametrize("vault", ["research_vault", "personal_vault"])
@pytest.mark.parametrize("partial", [False, True])
async def test_worker_results_preserve_vault_and_complete_cluster_metadata(
    sessions, monkeypatch, vault, partial
):
    with sessions() as session:
        created = spawn_dive(
            SpawnDiveRequest(thread_id=uuid.uuid4(), seeds=["test seed"], vault_schema=vault),
            session,
        )
        for current in ("research_vault", "personal_vault"):
            session.execute(
                text(
                    f"INSERT INTO {current}.sources VALUES (1, :title, 'Test Author', '2026-01-01')"
                ),
                {"title": current},
            )
            session.execute(text(f"INSERT INTO {current}.graph_node VALUES (1, 'paper-1', 0.9)"))
        session.execute(
            text(f"INSERT INTO {vault}.graph_edge VALUES (1,1,:id,'cites')"),
            {"id": created.exploration_id},
        )
        session.commit()
    monkeypatch.setattr(
        worker, "_resolve_seed", AsyncMock(return_value=(1, {"paperId": "paper-1"}))
    )
    monkeypatch.setattr(
        worker,
        "run_bfs",
        AsyncMock(
            return_value=DiveResult(
                visited_source_ids=[1],
                edge_count=1,
                s2_requests_used=1,
                elapsed_seconds=0.1,
                early_terminated=False,
                termination_reason="empty_frontier",
                errors=[],
            )
        ),
    )
    monkeypatch.setattr(
        worker,
        "cluster_exploration",
        AsyncMock(
            return_value={
                "n_papers": 1,
                "n_clusters": 1,
                "noise_count": 0,
                "clusters": [
                    {
                        "cluster_id": 0,
                        "size": 1,
                        "label_terms": ["test"],
                        "paper_source_ids": [1],
                        "top_papers": [1],
                    }
                ],
            }
        ),
    )
    monkeypatch.setattr(
        worker,
        "summarize_dive",
        AsyncMock(side_effect=RuntimeError("summary fixture unavailable"))
        if partial
        else AsyncMock(return_value="# Test summary"),
    )
    s2 = AsyncMock()
    s2.embedding.return_value = {}
    await worker.run_dive(
        exploration_id=created.exploration_id, session_factory=sessions, vault_schema=vault, s2=s2
    )
    with sessions() as session:
        row = session.execute(
            text("SELECT * FROM graph_exploration WHERE id=:id"), {"id": created.exploration_id}
        ).first()
        assert row.meta["vault_schema"] == vault
        assert row.meta["focus"] == "balanced"
        assert row.meta["result"]["version"] == "v1"
        assert row.meta["result"]["visited_source_ids"] == [1]
        assert row.finished_at is not None
        result = get_dive_results(created.exploration_id, session=session)
        assert result.papers[0]["title"] == vault
        assert result.papers[0]["reason"] == "top-cluster-paper"
        assert result.clusters[0]["top_papers"][0]["title"] == vault
        assert result.edge_counts_by_kind == {"cites": 1}
        assert result.result is not None
        assert bool(result.result.errors) is partial
    worker._write_error(
        sessions, created.exploration_id, error_md="stale error", meta={}, errors=[]
    )
    with sessions() as session:
        assert (
            session.execute(
                text("SELECT status FROM graph_exploration WHERE id=:id"),
                {"id": created.exploration_id},
            ).scalar()
            == "done"
        )


def test_error_write_preserves_identity_and_cannot_overwrite_terminal_result(sessions):
    with sessions() as session:
        created = spawn_dive(
            SpawnDiveRequest(thread_id=uuid.uuid4(), seeds=["test"], vault_schema="personal_vault"),
            session,
        )
    assert worker._claim_row(sessions, created.exploration_id)
    worker._write_error(
        sessions, created.exploration_id, error_md="test failure", meta={"edge_count": 0}, errors=[]
    )
    with sessions() as session:
        row = session.execute(
            text("SELECT * FROM graph_exploration WHERE id=:id"), {"id": created.exploration_id}
        ).first()
        assert row.meta["vault_schema"] == "personal_vault"
        assert row.meta["result"]["version"] == "v1"
        assert row.status == "error"
    worker._write_done(
        sessions, created.exploration_id, summary_md="late result", meta={}, errors=[]
    )
    with sessions() as session:
        assert (
            session.execute(
                text("SELECT status FROM graph_exploration WHERE id=:id"),
                {"id": created.exploration_id},
            ).scalar()
            == "error"
        )


@pytest.mark.parametrize("identity", [None, "personal_vault"])
async def test_worker_rejects_missing_or_mismatched_identity_before_graph_access(
    sessions, monkeypatch, identity
):
    with sessions() as session:
        created = spawn_dive(
            SpawnDiveRequest(thread_id=uuid.uuid4(), seeds=["test"], vault_schema="personal_vault"),
            session,
        )
        if identity is None:
            session.execute(
                text("UPDATE graph_exploration SET meta=meta - 'vault_schema' WHERE id=:id"),
                {"id": created.exploration_id},
            )
            session.commit()
    resolve = AsyncMock(return_value=None)
    monkeypatch.setattr(worker, "_resolve_seed", resolve)
    await worker.run_dive(
        exploration_id=created.exploration_id,
        session_factory=sessions,
        vault_schema="research_vault",
        s2=AsyncMock(),
    )
    resolve.assert_not_called()
    with sessions() as session:
        row = session.execute(
            text("SELECT status,error_md,meta FROM graph_exploration WHERE id=:id"),
            {"id": created.exploration_id},
        ).first()
        assert row.status == "error"
        assert "vault identity" in row.error_md
        assert row.meta.get("vault_schema") == identity

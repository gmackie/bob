"""REST endpoints for dive orchestration.

Task 3.6 of the academic-research-buddy implementation plan. Exposes
three endpoints that the OODA tRPC layer (Task 4.1) calls from the TS
side:

* ``POST /dives`` — create a ``graph_exploration`` row with
  ``status='queued'`` and return its id. The APScheduler poller
  (Task 3.7) is responsible for actually running the dive; this
  endpoint does NOT start a background task itself.
* ``GET /dives/{id}`` — return the current row as-is so a caller can
  poll for status.
* ``GET /dives/{id}/results`` — for a ``done`` dive, return the
  top-k ranked papers (joined against ``sources`` in the requested
  vault schema), the cluster summary pulled from ``meta``, and
  per-edge-kind aggregate counts.

Design notes
------------
* **Raw SQL via ``sqlalchemy.text``.** Matches :mod:`research_backend.dive.worker`
  and the other schema-aware readers — the ``graph_exploration`` table is
  owned by Drizzle and we treat it strictly as a Postgres artifact.
* **Vault schema is a request field, not a path component.** V1.5 only ships
  ``research_vault`` but the schema name is validated against a small
  allowlist so a malicious caller can't inject arbitrary SQL through it.
* **``get_db_session`` dependency.** Simple generator factory so tests can
  ``app.dependency_overrides[get_db_session] = ...`` to inject a fake
  session without standing up an engine.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

router = APIRouter(prefix="/dives", tags=["dives"])


_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})


# ---------------------------------------------------------------------------
# DB session dependency
# ---------------------------------------------------------------------------


def get_db_session(request: Request) -> Iterator[Any]:
    """Yield a SQLAlchemy session bound to the app engine.

    Kept separate from :func:`research_backend.db.get_session` so tests can
    override this dependency in isolation without touching the existing
    ``/api`` routes. In production both end up binding to the same
    ``app.state.engine``.
    """
    from sqlmodel import Session  # local import so tests that stub the dep don't pay the cost

    with Session(request.app.state.engine) as session:
        yield session


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SpawnDiveRequest(BaseModel):
    """Input for ``POST /dives``."""

    thread_id: uuid.UUID
    seeds: list[str] = Field(..., min_length=1, max_length=20)
    budget_papers: int = Field(60, ge=5, le=300)
    budget_seconds: int = Field(180, ge=30, le=900)
    focus: str = Field("balanced")  # "balanced" | "recent" | "foundational"
    vault_schema: str = Field("research_vault")


class SpawnDiveResponse(BaseModel):
    """Response for ``POST /dives``."""

    exploration_id: uuid.UUID
    status: str  # always "queued" on success


class DiveStatusResponse(BaseModel):
    """Response for ``GET /dives/{id}``."""

    id: uuid.UUID
    thread_id: uuid.UUID
    seed: list[str]
    budget_papers: int
    budget_seconds: int
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    summary_md: str | None
    meta: dict | None
    errors_json: list | dict | None
    error_md: str | None


class DiveResultsResponse(BaseModel):
    """Response for ``GET /dives/{id}/results``."""

    exploration_id: uuid.UUID
    status: str
    summary_md: str | None
    papers: list[dict]
    clusters: list[dict]
    edge_counts_by_kind: dict[str, int]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", response_model=SpawnDiveResponse)
def spawn_dive(
    req: SpawnDiveRequest,
    session: Any = Depends(get_db_session),
) -> SpawnDiveResponse:
    """Create a ``graph_exploration`` row with ``status='queued'``.

    For V1.5 this is the *only* producer of queued rows — the APScheduler
    poller (Task 3.7) is the consumer. We do not spawn a BackgroundTask
    here because the poller already owns dispatch, and doing both would
    create a double-execution hazard.
    """
    if req.vault_schema not in _VALID_SCHEMAS:
        raise HTTPException(
            status_code=400,
            detail=f"invalid vault_schema: {req.vault_schema!r}",
        )

    exploration_id = uuid.uuid4()
    meta = {"focus": req.focus, "vault_schema": req.vault_schema}
    session.execute(
        text(
            """
            INSERT INTO graph_exploration
                (id, thread_id, seed, budget_papers, budget_seconds, status, meta)
            VALUES
                (:id, :thread_id, :seed, :budget_papers, :budget_seconds,
                 'queued', CAST(:meta AS jsonb))
            """
        ),
        {
            "id": exploration_id,
            "thread_id": req.thread_id,
            "seed": list(req.seeds),
            "budget_papers": req.budget_papers,
            "budget_seconds": req.budget_seconds,
            "meta": json.dumps(meta),
        },
    )
    session.commit()
    return SpawnDiveResponse(exploration_id=exploration_id, status="queued")


@router.get("/{exploration_id}", response_model=DiveStatusResponse)
def get_dive_status(
    exploration_id: uuid.UUID,
    session: Any = Depends(get_db_session),
) -> DiveStatusResponse:
    """Return the current ``graph_exploration`` row.

    404 if the id is unknown. Columns that are nullable in the DB
    (``started_at``, ``summary_md``, ``meta``, ``errors_json``, ``error_md``)
    pass through as ``None`` in the response.
    """
    row = session.execute(
        text(
            """
            SELECT id,
                   thread_id,
                   seed,
                   budget_papers,
                   budget_seconds,
                   status,
                   started_at,
                   finished_at,
                   summary_md,
                   meta,
                   errors_json,
                   error_md
              FROM graph_exploration
             WHERE id = :id
            """
        ),
        {"id": exploration_id},
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"exploration {exploration_id} not found")

    return DiveStatusResponse(
        id=row.id,
        thread_id=row.thread_id,
        seed=list(row.seed or []),
        budget_papers=int(row.budget_papers or 0),
        budget_seconds=int(row.budget_seconds or 0),
        status=row.status,
        started_at=row.started_at,
        finished_at=row.finished_at,
        summary_md=row.summary_md,
        meta=row.meta if isinstance(row.meta, dict) else None,
        errors_json=row.errors_json if isinstance(row.errors_json, (list, dict)) else None,
        error_md=row.error_md,
    )


@router.get("/{exploration_id}/results", response_model=DiveResultsResponse)
def get_dive_results(
    exploration_id: uuid.UUID,
    top_k: int = 10,
    session: Any = Depends(get_db_session),
) -> DiveResultsResponse:
    """Return ranked top-k papers for a completed dive.

    If ``status`` is not ``done`` we still return 200 with empty papers /
    clusters / edge_counts — this keeps the endpoint idempotent for
    clients polling during a running dive instead of forcing them to
    disambiguate 404 vs "not done yet".

    For ``done`` dives:

    * ``papers`` — distinct ``source_id``\\s that appear in any edge
      discovered during this exploration, joined to ``{schema}.sources``
      and ranked by ``graph_node.influence_score`` DESC, ``source_ts``
      DESC (recency tiebreak), limited to ``top_k``. Each entry carries
      a ``reason`` field (``"high-influence"`` unless the paper also
      appears in a cluster's ``top_papers``, in which case
      ``"top-cluster-paper"``).
    * ``clusters`` — pulled straight from
      ``graph_exploration.meta["cluster_summary"]["clusters"]``. For V1.5
      the orchestrator stores cluster metadata directly under
      ``meta["clusters"]`` so we fall back to that location when
      ``cluster_summary`` isn't present.
    * ``edge_counts_by_kind`` — ``SELECT kind, COUNT(*) FROM
      {schema}.graph_edge WHERE discovered_in = :id GROUP BY kind``.
    """
    # Load the row itself to pull status, summary, meta, and the vault schema
    # that owns graph_node / graph_edge for this exploration.
    row = session.execute(
        text(
            """
            SELECT id, status, summary_md, meta
              FROM graph_exploration
             WHERE id = :id
            """
        ),
        {"id": exploration_id},
    ).first()
    if row is None:
        raise HTTPException(
            status_code=404, detail=f"exploration {exploration_id} not found"
        )

    meta = row.meta if isinstance(row.meta, dict) else {}
    vault_schema = meta.get("vault_schema") or "research_vault"
    if vault_schema not in _VALID_SCHEMAS:
        # Paranoid guard — meta is writer-controlled but still, don't let
        # a bad meta value produce arbitrary SQL.
        vault_schema = "research_vault"

    # Pull cluster summary out of meta; tolerate both layouts.
    cluster_summary: dict[str, Any] = {}
    if isinstance(meta.get("cluster_summary"), dict):
        cluster_summary = meta["cluster_summary"]
    clusters_raw: list[dict[str, Any]] = []
    if isinstance(cluster_summary.get("clusters"), list):
        clusters_raw = [c for c in cluster_summary["clusters"] if isinstance(c, dict)]
    elif isinstance(meta.get("clusters"), list):
        clusters_raw = [c for c in meta["clusters"] if isinstance(c, dict)]

    clusters_out: list[dict[str, Any]] = []
    top_cluster_source_ids: set[int] = set()
    for cluster in clusters_raw:
        cid = cluster.get("cluster_id")
        out: dict[str, Any] = {
            "cluster_id": int(cid) if cid is not None else None,
            "size": int(cluster.get("size") or 0),
        }
        if "label_terms" in cluster:
            out["label_terms"] = cluster["label_terms"]
        if "paper_source_ids" in cluster:
            out["paper_source_ids"] = cluster["paper_source_ids"]
        if "top_papers" in cluster:
            out["top_papers"] = cluster["top_papers"]
            for entry in cluster["top_papers"] or []:
                if isinstance(entry, int):
                    top_cluster_source_ids.add(entry)
                elif isinstance(entry, dict) and isinstance(entry.get("source_id"), int):
                    top_cluster_source_ids.add(int(entry["source_id"]))
        clusters_out.append(out)

    # Short-circuit: not done -> empty result bodies but still 200.
    if row.status != "done":
        return DiveResultsResponse(
            exploration_id=row.id,
            status=row.status,
            summary_md=row.summary_md,
            papers=[],
            clusters=[],
            edge_counts_by_kind={},
        )

    # Edge counts grouped by kind.
    edge_rows = session.execute(
        text(
            f"""
            SELECT kind, COUNT(*) AS n
              FROM {vault_schema}.graph_edge
             WHERE discovered_in = :id
             GROUP BY kind
            """
        ),
        {"id": exploration_id},
    ).all()
    edge_counts_by_kind: dict[str, int] = {
        str(r.kind): int(r.n) for r in edge_rows
    }

    # Top-k papers: distinct source_ids across all edges discovered in this
    # exploration, joined to sources + graph_node for metadata & influence.
    paper_rows = session.execute(
        text(
            f"""
            WITH involved AS (
                SELECT DISTINCT from_source_id AS source_id
                  FROM {vault_schema}.graph_edge
                 WHERE discovered_in = :id
                UNION
                SELECT DISTINCT to_source_id AS source_id
                  FROM {vault_schema}.graph_edge
                 WHERE discovered_in = :id
            )
            SELECT s.id            AS source_id,
                   s.title         AS title,
                   s.author        AS author,
                   s.source_ts     AS source_ts,
                   COALESCE(gn.influence_score, 0.0) AS influence_score
              FROM involved i
              JOIN {vault_schema}.sources s
                ON s.id = i.source_id
         LEFT JOIN {vault_schema}.graph_node gn
                ON gn.source_id = s.id
             ORDER BY influence_score DESC NULLS LAST,
                      s.source_ts       DESC NULLS LAST
             LIMIT :top_k
            """
        ),
        {"id": exploration_id, "top_k": int(top_k)},
    ).all()

    papers: list[dict[str, Any]] = []
    for pr in paper_rows:
        year: int | None = None
        if pr.source_ts is not None:
            try:
                year = int(pr.source_ts.year)
            except AttributeError:
                year = None
        sid = int(pr.source_id)
        reason = (
            "top-cluster-paper" if sid in top_cluster_source_ids else "high-influence"
        )
        papers.append(
            {
                "source_id": sid,
                "title": pr.title or "(untitled)",
                "authors": pr.author or "",
                "year": year,
                "influence_score": float(pr.influence_score or 0.0),
                "reason": reason,
            }
        )

    return DiveResultsResponse(
        exploration_id=row.id,
        status=row.status,
        summary_md=row.summary_md,
        papers=papers,
        clusters=clusters_out,
        edge_counts_by_kind=edge_counts_by_kind,
    )

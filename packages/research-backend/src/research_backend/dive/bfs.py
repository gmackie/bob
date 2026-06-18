"""Priority-driven BFS expansion over the Semantic Scholar citation graph.

Task 3.2 of the academic-research-buddy plan. Given a small set of seed
papers already in the ``sources`` table, walks outward through S2's
``references`` / ``citations`` / ``recommendations`` endpoints, upserting
newly discovered papers and recording edges in ``graph_edge``. Every
iteration picks the highest-priority paper off the frontier, fetches its
three neighbor kinds, scores each neighbor with
:func:`research_backend.dive.priority.priority`, and pushes the qualifying
ones back onto the frontier.

Design notes
------------
* **Frontier ordering.** A sorted Python list keyed by priority. Typical
  frontiers stay <100 items (budget caps ensure this); a real heap would
  add complexity for no win at this scale.
* **Sync-in-async DB writes.** :func:`research_backend.s2.ingest.upsert_s2_paper`
  is a synchronous function using SQLAlchemy ``Session`` / ``session.execute``.
  We run it via :func:`asyncio.to_thread` so the event loop stays free for
  in-flight HTTP requests. The same goes for edge inserts.
* **Idempotency.** Source upserts dedupe on ``(kind, external_id)`` / DOI
  via ``upsert_s2_paper``. Edge inserts use
  ``ON CONFLICT (from_source_id, to_source_id, kind) DO NOTHING`` so a second
  run of the same dive produces zero new rows. ``first_seen_exploration`` on
  ``graph_node`` is preserved on conflict (see ``upsert_s2_paper``), so the
  *earliest* exploration that discovered a paper owns the provenance.
* **Budgets.** Three orthogonal limits: ``max_papers`` (paper visits),
  ``max_seconds`` (wall clock, measured via ``time.monotonic``), and
  ``max_s2_requests`` (network calls — includes both seed prefetches and
  neighbor fetches). Whichever hits first wins. We also short-circuit on
  an empty frontier and on a low-yield window (last N iterations produced
  <M qualifying neighbors) — both signals that further expansion is
  unlikely to surface interesting papers.
* **Per-call failure isolation.** One S2 endpoint throwing (after retries
  are exhausted, so this is genuinely the end of the road for that URL)
  does not fail the whole dive. We record the error on a ``errors`` list
  and continue with the next neighbor kind or paper. The orchestrator
  (Task 3.5) persists this list into ``graph_exploration.errors_json``.
"""

from __future__ import annotations

import asyncio
import heapq
import logging
import time
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from typing import Any

import httpx
import numpy as np
from sqlalchemy import text

from ..s2.client import S2Client
from ..s2.ingest import upsert_s2_paper
from .priority import _ref_ids, priority

logger = logging.getLogger(__name__)


__all__ = ["DiveBudget", "DiveResult", "run_bfs"]


_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})


# Maps the three S2 neighbor endpoints onto the enum values in
# ``graph_edge.kind`` (see ``packages/db/drizzle/0003_research_buddy_schema.sql``).
_EDGE_KIND_MAP: dict[str, str] = {
    "references": "references",
    "citations": "cites",
    "recommendations": "recommended_by_s2",
}


@dataclass
class DiveBudget:
    """Budgets bounding a single BFS run.

    ``max_papers`` counts *papers expanded* (popped from the frontier), not
    papers merely discovered — a newly scored neighbor that never gets
    expanded still lands in ``sources`` / ``graph_node`` but doesn't tick
    the paper budget. This makes the budget directly correlate with the
    number of network round-trips the dive can cost.
    """

    max_papers: int = 60
    max_seconds: int = 180
    max_s2_requests: int = 200


@dataclass
class DiveResult:
    """Aggregated outcome of a BFS run.

    ``visited_source_ids`` is the *ordered* list of papers expanded, so the
    first entries are the seed papers and later entries are the highest-
    priority neighbors discovered along the way. Callers can use this as a
    basis for per-exploration ranking when rendering results.
    """

    visited_source_ids: list[int]
    edge_count: int
    s2_requests_used: int
    elapsed_seconds: float
    early_terminated: bool
    termination_reason: str
    errors: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _neighbor_paper(edge_kind: str, entry: Any) -> dict[str, Any] | None:
    """Extract the inner paper dict from an S2 neighbor-list entry.

    S2's ``/references`` returns ``{"data": [{"citedPaper": {...}}, ...]}``,
    ``/citations`` returns ``{"data": [{"citingPaper": {...}}, ...]}``, and
    ``/recommendations`` returns ``{"recommendedPapers": [{...}, ...]}``.
    Normalize all three to a plain paper dict with at minimum ``paperId``.
    Returns ``None`` for malformed entries so callers can ``filter`` cleanly.
    """
    if not isinstance(entry, dict):
        return None
    if edge_kind == "references":
        paper = entry.get("citedPaper")
    elif edge_kind == "citations":
        paper = entry.get("citingPaper")
    else:
        # Recommendations already returns papers directly.
        paper = entry
    if not isinstance(paper, dict):
        return None
    if not paper.get("paperId"):
        return None
    return paper


def _neighbors_from_response(
    edge_kind: str, response: dict[str, Any]
) -> list[dict[str, Any]]:
    """Pull the list of neighbor papers out of one S2 response envelope."""
    if edge_kind == "recommendations":
        raw = response.get("recommendedPapers") or []
    else:
        raw = response.get("data") or []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for entry in raw:
        paper = _neighbor_paper(edge_kind, entry)
        if paper is not None:
            out.append(paper)
    return out


def _update_seen_authors(seen: set[str], paper: dict[str, Any]) -> None:
    """Merge authors of ``paper`` into ``seen`` (lowercased + stripped)."""
    for author in paper.get("authors") or []:
        if isinstance(author, dict):
            name = author.get("name")
        else:
            name = author
        if isinstance(name, str):
            norm = name.strip().lower()
            if norm:
                seen.add(norm)


def _lookup_seed_papers(
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    seed_source_ids: list[int],
) -> list[tuple[int, str]]:
    """Return ``(source_id, s2_paper_id)`` pairs for every seed that has a
    ``graph_node`` row. Seeds without a matching row are logged and skipped
    — the dive is still useful; we simply don't have an S2 handle to expand
    from.
    """
    if not seed_source_ids:
        return []
    with session_factory() as session:
        rows = session.execute(
            text(
                f"""
                SELECT source_id, s2_paper_id
                  FROM {vault_schema}.graph_node
                 WHERE source_id = ANY(:ids)
                """
            ),
            {"ids": list(seed_source_ids)},
        ).all()
    resolved = {int(r.source_id): r.s2_paper_id for r in rows if r.s2_paper_id}
    out: list[tuple[int, str]] = []
    for sid in seed_source_ids:
        if sid in resolved:
            out.append((sid, resolved[sid]))
        else:
            logger.info(
                "bfs: seed source_id=%s has no s2_paper_id; skipping", sid
            )
    return out


def _insert_edge(
    session: Any,
    vault_schema: str,
    from_source_id: int,
    to_source_id: int,
    edge_kind: str,
    exploration_id: uuid.UUID,
) -> None:
    """Idempotently insert one ``graph_edge`` row.

    The composite primary key is ``(from_source_id, to_source_id, kind)`` —
    ``ON CONFLICT DO NOTHING`` is safe because we only ever attach
    ``discovered_in`` on the first insertion (the default), which is the
    correct provenance semantics.
    """
    session.execute(
        text(
            f"""
            INSERT INTO {vault_schema}.graph_edge
                (from_source_id, to_source_id, kind, discovered_in)
            VALUES (:from_id, :to_id, :kind, :discovered_in)
            ON CONFLICT (from_source_id, to_source_id, kind) DO NOTHING
            """
        ),
        {
            "from_id": from_source_id,
            "to_id": to_source_id,
            "kind": edge_kind,
            "discovered_in": exploration_id,
        },
    )


def _run_edge_insert(
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    from_source_id: int,
    to_source_id: int,
    edge_kind: str,
    exploration_id: uuid.UUID,
) -> None:
    """Open a session, insert the edge, commit. Called via ``asyncio.to_thread``.

    We use a fresh short-lived session per edge so a failed write on paper A
    doesn't poison an in-flight session used by paper B. The cost (~1 ms per
    insert on local PG) is dominated by S2 network latency.
    """
    with session_factory() as session:
        _insert_edge(
            session,
            vault_schema,
            from_source_id,
            to_source_id,
            edge_kind,
            exploration_id,
        )
        session.commit()


# ---------------------------------------------------------------------------
# Main BFS loop
# ---------------------------------------------------------------------------


async def run_bfs(
    *,
    s2: S2Client,
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    exploration_id: uuid.UUID,
    seed_source_ids: list[int],
    focus: str = "balanced",
    focus_embedding: np.ndarray | None = None,
    budget: DiveBudget | None = None,
    low_yield_threshold: int = 3,
    low_yield_window: int = 10,
    reference_year: int = 2026,
    clock: Callable[[], float] = time.monotonic,
) -> DiveResult:
    """Run priority-driven BFS expansion from ``seed_source_ids``.

    See the module docstring for the overall shape. ``clock`` is injected
    so tests can fast-forward through ``budget.max_seconds`` without real
    sleeps. The default is ``time.monotonic`` which is immune to NTP
    adjustments — critical for honoring a wall-clock budget.
    """
    if vault_schema not in _VALID_SCHEMAS:
        raise ValueError(f"invalid vault schema: {vault_schema!r}")
    budget = budget or DiveBudget()

    start = clock()
    errors: list[dict[str, Any]] = []
    visited_source_ids: list[int] = []
    seen_source_ids: set[int] = set()
    seen_authors: set[str] = set()
    edge_count = 0
    s2_requests_used = 0
    # Rolling window of "new qualifying neighbors per iteration" so we can
    # detect an unproductive tail and terminate early.
    yield_window: list[int] = []

    # ------------------------------------------------------------------
    # Resolve seeds → (source_id, s2_paper_id) pairs and pre-fetch them.
    # Pre-fetch is skipped when S2 is disabled (see S2Client.disabled):
    # in that case all endpoint calls return {}, so seed metadata would be
    # empty too; the pre-fetch would just burn one "request" per seed in
    # our accounting with no gain.
    # ------------------------------------------------------------------
    seeds = _lookup_seed_papers(session_factory, vault_schema, seed_source_ids)
    seed_papers: list[dict[str, Any]] = []

    # Build the initial frontier from seeds. Seeds get priority 1.0 so we
    # always expand them first.
    #
    # Frontier is a min-heap on ``-priority`` so ``heappop`` returns the
    # highest-priority entry. The tuple includes source_id + s2_id as
    # secondary sort keys to guarantee a total ordering (heapq compares
    # tuple elements in order on ties).
    frontier: list[tuple[float, int, str]] = []  # (-priority, source_id, s2_id)
    for source_id, s2_id in seeds:
        heapq.heappush(frontier, (-1.0, source_id, s2_id))
        seen_source_ids.add(source_id)

    if not s2.disabled:
        for source_id, s2_id in seeds:
            if s2_requests_used >= budget.max_s2_requests:
                break
            try:
                paper = await s2.paper(s2_id)
                s2_requests_used += 1
                if paper:
                    seed_papers.append(paper)
                    _update_seen_authors(seen_authors, paper)
            except httpx.HTTPStatusError as exc:
                s2_requests_used += 1
                errors.append(
                    {
                        "phase": "seed_prefetch",
                        "source_id": source_id,
                        "s2_paper_id": s2_id,
                        "error": str(exc),
                    }
                )

    # Precompute the union of seed references once. ``priority()`` accepts
    # the precomputed set via ``precomputed_seed_refs`` so the inner loop
    # doesn't rebuild the union on every neighbor (previously O(seeds *
    # refs_per_seed) per ``priority()`` call, ~9M set unions per dive).
    seed_refs: set[str] = set()
    for p in seed_papers:
        seed_refs |= _ref_ids(p)

    termination_reason = "empty_frontier"
    early_terminated = False

    def _budget_exhausted() -> tuple[bool, str]:
        if len(visited_source_ids) >= budget.max_papers:
            return True, "budget_papers"
        if clock() - start >= budget.max_seconds:
            return True, "budget_seconds"
        if s2_requests_used >= budget.max_s2_requests:
            return True, "budget_s2_requests"
        return False, ""

    # Check budget before even starting the loop — tests with zero-second
    # budgets rely on this.
    exhausted, reason = _budget_exhausted()
    if exhausted:
        return DiveResult(
            visited_source_ids=visited_source_ids,
            edge_count=edge_count,
            s2_requests_used=s2_requests_used,
            elapsed_seconds=clock() - start,
            early_terminated=True,
            termination_reason=reason,
            errors=errors,
        )

    while frontier:
        # Pop highest-priority (stored as ``-score`` so the min-heap surfaces
        # the largest score first). O(log N) — no full sort, no O(N) shift.
        _neg_prio, current_source_id, current_s2_id = heapq.heappop(frontier)

        visited_source_ids.append(current_source_id)
        iteration_new = 0

        for endpoint_kind in ("references", "citations", "recommendations"):
            # Re-check time + request budgets mid-iteration so a paper with
            # an expensive neighbor list can't wildly overshoot. We
            # deliberately don't re-check ``max_papers`` here — visited is
            # incremented at the top of the iteration, so that check would
            # always fire on the final-allowed paper before its neighbors
            # got processed.
            if clock() - start >= budget.max_seconds:
                early_terminated = True
                termination_reason = "budget_seconds"
                break

            if s2_requests_used >= budget.max_s2_requests:
                early_terminated = True
                termination_reason = "budget_s2_requests"
                break

            try:
                if endpoint_kind == "references":
                    response = await s2.references(current_s2_id)
                elif endpoint_kind == "citations":
                    response = await s2.citations(current_s2_id)
                else:
                    response = await s2.recommendations(current_s2_id)
                s2_requests_used += 1
            except httpx.HTTPStatusError as exc:
                s2_requests_used += 1
                errors.append(
                    {
                        "phase": endpoint_kind,
                        "source_id": current_source_id,
                        "s2_paper_id": current_s2_id,
                        "error": str(exc),
                    }
                )
                continue
            except Exception as exc:  # noqa: BLE001 — defensive: don't crash dive
                errors.append(
                    {
                        "phase": endpoint_kind,
                        "source_id": current_source_id,
                        "s2_paper_id": current_s2_id,
                        "error": repr(exc),
                    }
                )
                continue

            edge_kind = _EDGE_KIND_MAP[endpoint_kind]
            for neighbor in _neighbors_from_response(endpoint_kind, response):
                neighbor_s2_id = neighbor["paperId"]

                # Upsert source + graph_node; run the sync DB work off the
                # event loop so in-flight HTTP doesn't stall.
                try:
                    neighbor_source_id = await asyncio.to_thread(
                        _upsert_in_session,
                        session_factory,
                        vault_schema,
                        neighbor,
                        exploration_id,
                    )
                except Exception as exc:  # noqa: BLE001
                    errors.append(
                        {
                            "phase": "upsert",
                            "source_id": current_source_id,
                            "s2_paper_id": neighbor_s2_id,
                            "error": repr(exc),
                        }
                    )
                    continue

                # Record the edge. Idempotent via ON CONFLICT.
                try:
                    await asyncio.to_thread(
                        _run_edge_insert,
                        session_factory,
                        vault_schema,
                        current_source_id,
                        neighbor_source_id,
                        edge_kind,
                        exploration_id,
                    )
                    edge_count += 1
                except Exception as exc:  # noqa: BLE001
                    errors.append(
                        {
                            "phase": "edge_insert",
                            "from_source_id": current_source_id,
                            "to_source_id": neighbor_source_id,
                            "error": repr(exc),
                        }
                    )

                # Already-seen: no need to score / queue again. We still
                # recorded the edge above, because a paper can be reached
                # from multiple parents with different edge kinds.
                if neighbor_source_id in seen_source_ids:
                    continue

                score = priority(
                    neighbor,
                    seeds=seed_papers,
                    focus_embedding=focus_embedding,
                    seen_authors=seen_authors,
                    focus=focus,
                    reference_year=reference_year,
                    precomputed_seed_refs=seed_refs,
                )
                # A 0.0 floor means "add anything non-trivial to the
                # frontier". Tightening this threshold is a future tuning
                # knob; keeping it permissive for now lets the priority
                # ordering do the work of steering the dive.
                if score > 0.0:
                    heapq.heappush(
                        frontier, (-score, neighbor_source_id, neighbor_s2_id)
                    )
                    seen_source_ids.add(neighbor_source_id)
                    _update_seen_authors(seen_authors, neighbor)
                    iteration_new += 1
                else:
                    # Mark seen anyway so we don't re-score it if it shows
                    # up from another parent.
                    seen_source_ids.add(neighbor_source_id)

            if early_terminated:
                break

        if early_terminated:
            break

        # ------------------------------------------------------------------
        # Low-yield termination. Only kicks in once we've accumulated a
        # full window — otherwise the first few iterations (which often
        # look lean while seeds fan out) would misfire as "low yield".
        # ------------------------------------------------------------------
        yield_window.append(iteration_new)
        if len(yield_window) > low_yield_window:
            yield_window.pop(0)
        if (
            len(yield_window) == low_yield_window
            and sum(yield_window) < low_yield_threshold
        ):
            early_terminated = True
            termination_reason = "low_yield"
            break

        exhausted, reason = _budget_exhausted()
        if exhausted:
            early_terminated = True
            termination_reason = reason
            break

    # If we fell out of the loop naturally (frontier drained), the reason
    # is "empty_frontier" unless early_terminated was set above.
    if not early_terminated:
        termination_reason = "empty_frontier"

    return DiveResult(
        visited_source_ids=visited_source_ids,
        edge_count=edge_count,
        s2_requests_used=s2_requests_used,
        elapsed_seconds=clock() - start,
        early_terminated=early_terminated,
        termination_reason=termination_reason,
        errors=errors,
    )


def _upsert_in_session(
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    paper: dict[str, Any],
    exploration_id: uuid.UUID,
) -> int:
    """Open a short-lived session, upsert the paper, return its source_id.

    Wrapper around :func:`upsert_s2_paper` so tests can monkeypatch the
    upsert without having to also stub out session management. Because
    ``upsert_s2_paper`` commits internally, we don't need to commit here.
    """
    with session_factory() as session:
        return upsert_s2_paper(
            session,
            vault_schema,
            paper,
            first_seen_exploration=exploration_id,
        )

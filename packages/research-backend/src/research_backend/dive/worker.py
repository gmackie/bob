"""Dive orchestrator: queued → running → done/error.

Task 3.5 of the academic-research-buddy plan. Given an ``exploration_id``
that points at a ``graph_exploration`` row with ``status='queued'``, this
module drives the full pipeline end-to-end:

1. Claim the row by transitioning ``queued → running`` in a single SQL
   update. If no row matches (another worker already claimed it, or the
   row was cancelled), no-op and return.
2. Load the claimed row to pull seeds, focus preset, and budget overrides.
3. Resolve each seed string (DOI, S2 id, or free-text) into a ``source_id``
   via :mod:`research_backend.s2.ingest`. Seeds that can't be resolved are
   logged and skipped; if **every** seed fails, the dive is marked error.
4. Compute a focus embedding from the first resolved seed (best-effort —
   failures fall back to ``None`` and BFS still runs with a textual focus
   signal only).
5. Run :func:`research_backend.dive.bfs.run_bfs`.
6. Run :func:`research_backend.clustering.cluster_exploration`. If it
   raises, we log and proceed with an empty-clusters dict — the
   summarizer has a flat fallback for that case.
7. Enrich clusters' ``top_papers`` entries with title/authors/year pulled
   from ``sources`` + ``graph_node`` so the LLM prompt carries real
   metadata instead of just source_ids.
8. Run :func:`research_backend.dive.summarize.summarize_dive`.
9. Persist results: ``summary_md``, ``meta`` (BFS stats + cluster counts),
   ``errors_json`` (BFS/cluster/summarize per-step errors), ``finished_at``,
   ``status='done'``.

Error semantics
---------------
The whole flow is wrapped in try/except. Only *unrecoverable* errors —
DB connectivity, zero resolved seeds, or a BFS exception that prevents any
paper from being visited — mark the whole dive ``error``. Clustering and
summarization failures are logged, captured in ``errors_json`` under
``phase: cluster`` / ``phase: summarize``, and the dive still ends
``done`` with whatever partial output survived.

Design notes
------------
* **Idempotency of status transitions.** The opening ``UPDATE ... WHERE
  status='queued'`` acts as a compare-and-swap; two workers racing to
  claim the same row see one success (rowcount 1) and one no-op (rowcount
  0). We check ``rowcount`` and return early on zero.
* **Sync DB writes from async code.** Same pattern as ``bfs.py`` and
  ``ingest.py`` — short-lived sessions wrapped in ``asyncio.to_thread``
  so the event loop stays free during in-flight HTTP.
* **Raw SQL for status/results writes.** The ``graph_exploration`` row is
  owned by Drizzle; keeping everything here as ``sqlalchemy.text`` calls
  with explicit JSONB casts mirrors the rest of the backend.
* **Injectable S2 client.** Tests pass a mock; the default path builds a
  real :class:`S2Client` bound to an httpx client + :class:`S2Cache` on
  the caller's vault schema.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any

import httpx
import numpy as np
from sqlalchemy import text

from research_backend.clustering import cluster_exploration
from research_backend.dive.bfs import DiveBudget, DiveResult, run_bfs
from research_backend.dive.summarize import summarize_dive
from research_backend.s2.cache import S2Cache
from research_backend.s2.client import S2Client, get_shared_rate_limiter
from research_backend.s2.ingest import upsert_s2_paper

logger = logging.getLogger(__name__)

__all__ = ["DiveError", "DiveResult", "run_dive"]


_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})
_DOI_RE = re.compile(r"^10\.")


class DiveError(Exception):
    """Unrecoverable error in the dive orchestrator.

    Raised when the orchestrator cannot make meaningful progress — e.g.
    no seed resolves to a ``source_id``. Caught by the top-level handler
    which records the message on ``graph_exploration.error_md`` and
    transitions the row to ``status='error'``.
    """


# ---------------------------------------------------------------------------
# Seed resolution
# ---------------------------------------------------------------------------


def _seed_kind(seed: str) -> str:
    """Classify a seed string as ``doi``, ``s2_id``, or ``freetext``.

    * Strings starting with ``10.`` are treated as DOIs.
    * Alphanumeric strings (plus ``-`` / ``_``) with no whitespace are
      treated as opaque S2 paper IDs — S2 paper IDs are the 40-hex
      SHA-1-like ``paperId`` or ``CorpusId:12345`` forms. We keep this
      loose to also accept bare S2 ids users may paste.
    * Everything else — including anything with whitespace, quotes, or
      punctuation that wouldn't appear in an id — is free-text and
      goes through ``paper_search``.
    """
    seed = seed.strip()
    if _DOI_RE.match(seed):
        return "doi"
    if " " in seed or "\t" in seed:
        return "freetext"
    # S2 paper IDs are typically 40-char hex. Also accept ``CorpusId:123`` /
    # ``MAG:456`` prefixes the API supports.
    if re.fullmatch(r"[A-Za-z0-9_\-:]+", seed):
        return "s2_id"
    return "freetext"


async def _resolve_seed(
    *,
    s2: S2Client,
    seed: str,
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    exploration_id: uuid.UUID,
) -> tuple[int, dict[str, Any]] | None:
    """Resolve one seed string into ``(source_id, paper_dict)`` or ``None``.

    On the happy path we end up with both the DB source_id and the S2
    paper dict so the caller can use either (e.g. the paper dict for
    focus embedding fetch, the source_id for BFS seeds).
    """
    kind = _seed_kind(seed)
    paper: dict[str, Any] | None = None
    try:
        if kind == "doi":
            paper = await s2.paper(f"DOI:{seed}")
        elif kind == "s2_id":
            paper = await s2.paper(seed)
        else:
            search = await s2.paper_search(seed, limit=1)
            data = (search or {}).get("data") or []
            if data and isinstance(data[0], dict) and data[0].get("paperId"):
                paper_id = data[0]["paperId"]
                paper = await s2.paper(paper_id)
    except Exception as exc:  # noqa: BLE001 — one bad seed shouldn't stop the dive
        logger.warning(
            "dive: seed resolution failed seed=%r kind=%s: %s", seed, kind, exc
        )
        return None

    if not paper or not paper.get("paperId"):
        logger.info("dive: seed %r (%s) produced no paper", seed, kind)
        return None

    try:
        source_id = await asyncio.to_thread(
            _upsert_paper_sync,
            session_factory,
            vault_schema,
            paper,
            exploration_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "dive: seed upsert failed seed=%r paperId=%s: %s",
            seed,
            paper.get("paperId"),
            exc,
        )
        return None

    return source_id, paper


def _upsert_paper_sync(
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    paper: dict[str, Any],
    exploration_id: uuid.UUID,
) -> int:
    """Sync helper so :func:`asyncio.to_thread` has a plain function handle."""
    with session_factory() as session:
        return upsert_s2_paper(
            session,
            vault_schema,
            paper,
            first_seen_exploration=exploration_id,
        )


# ---------------------------------------------------------------------------
# DB helpers for the orchestrator
# ---------------------------------------------------------------------------


def _claim_row(
    session_factory: Callable[[], AbstractContextManager[Any]],
    exploration_id: uuid.UUID,
) -> bool:
    """Atomically flip status ``queued → running`` and set ``started_at``.

    Returns ``True`` if this worker won the race. Returns ``False`` if
    the row was already running / done / error (or missing).
    """
    with session_factory() as session:
        result = session.execute(
            text(
                """
                UPDATE graph_exploration
                   SET status = 'running',
                       started_at = NOW()
                 WHERE id = :id
                   AND status = 'queued'
                """
            ),
            {"id": exploration_id},
        )
        session.commit()
        return bool(result.rowcount)


def _load_row(
    session_factory: Callable[[], AbstractContextManager[Any]],
    exploration_id: uuid.UUID,
) -> dict[str, Any] | None:
    """Return ``{seed, focus, budget_papers, budget_seconds}`` for the row.

    ``focus`` is not a column on ``graph_exploration`` today — it lives
    inside ``meta`` as ``{"focus": "balanced"}`` when the caller
    (Task 3.6 REST endpoint) set one. We decode it here so downstream
    callers see a plain string.
    """
    with session_factory() as session:
        row = session.execute(
            text(
                """
                SELECT seed,
                       budget_papers,
                       budget_seconds,
                       meta
                  FROM graph_exploration
                 WHERE id = :id
                """
            ),
            {"id": exploration_id},
        ).first()
    if row is None:
        return None
    meta = row.meta or {}
    if not isinstance(meta, dict):
        meta = {}
    focus = meta.get("focus") or "balanced"
    return {
        "seed": list(row.seed or []),
        "budget_papers": int(row.budget_papers or 60),
        "budget_seconds": int(row.budget_seconds or 180),
        "focus": focus,
    }


def _fetch_visited_metadata(
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    source_ids: list[int],
) -> dict[int, dict[str, Any]]:
    """Pull title/author/year/influence for a batch of source_ids.

    Returns ``{source_id: {title, authors, year, influence_score,
    source_id, s2_paper_id}}``. Missing rows are omitted. We fetch
    ``source_ts`` from ``sources`` (set to Jan 1 of publication year by
    :func:`upsert_s2_paper`) and project it back to a bare year so the
    summarizer sees a plain int.
    """
    if not source_ids:
        return {}
    with session_factory() as session:
        rows = session.execute(
            text(
                f"""
                SELECT s.id         AS source_id,
                       s.title      AS title,
                       s.author     AS author,
                       s.source_ts  AS source_ts,
                       gn.s2_paper_id AS s2_paper_id,
                       gn.influence_score AS influence_score
                  FROM {vault_schema}.sources s
             LEFT JOIN {vault_schema}.graph_node gn
                    ON gn.source_id = s.id
                 WHERE s.id = ANY(:ids)
                """
            ),
            {"ids": list(source_ids)},
        ).all()
    out: dict[int, dict[str, Any]] = {}
    for r in rows:
        year: int | None = None
        if r.source_ts is not None:
            try:
                year = int(r.source_ts.year)
            except AttributeError:
                year = None
        out[int(r.source_id)] = {
            "source_id": int(r.source_id),
            "s2_paper_id": r.s2_paper_id,
            "title": r.title or "(untitled)",
            "authors": [r.author] if r.author else [],
            "year": year,
            "influence_score": float(r.influence_score or 0.0),
        }
    return out


def _write_done(
    session_factory: Callable[[], AbstractContextManager[Any]],
    exploration_id: uuid.UUID,
    *,
    summary_md: str | None,
    meta: dict[str, Any],
    errors: list[dict[str, Any]],
) -> None:
    """Commit the success case: status=done, summary/meta/errors/finished_at.

    CAS on ``status = 'running'`` so a slow worker finishing after the orphan
    reaper (``reap_stale_once``) already flipped the row to ``error`` cannot
    silently clobber ``error_md`` by writing ``done`` on top of the reaped
    error state. rowcount=0 here means the reaper (or another writer) won the
    race: log and return without committing.
    """
    with session_factory() as session:
        result = session.execute(
            text(
                """
                UPDATE graph_exploration
                   SET status = 'done',
                       summary_md = :summary_md,
                       meta = CAST(:meta AS jsonb),
                       errors_json = CAST(:errors AS jsonb),
                       finished_at = NOW()
                 WHERE id = :id
                   AND status = 'running'
                """
            ),
            {
                "id": exploration_id,
                "summary_md": summary_md,
                "meta": json.dumps(meta),
                "errors": json.dumps(errors),
            },
        )
        session.commit()
        if result.rowcount == 0:
            logger.warning(
                "dive.worker._write_done: CAS lost for exploration %s "
                "(row not in 'running' state — likely reaped or completed)",
                exploration_id,
            )


def _write_error(
    session_factory: Callable[[], AbstractContextManager[Any]],
    exploration_id: uuid.UUID,
    *,
    error_md: str,
    meta: dict[str, Any] | None,
    errors: list[dict[str, Any]],
) -> None:
    """Commit the failure case: status=error, error_md, partial meta/errors."""
    payload = {
        "id": exploration_id,
        "error_md": error_md,
        "errors": json.dumps(errors),
    }
    meta_sql = "meta"
    if meta is not None:
        meta_sql = "CAST(:meta AS jsonb)"
        payload["meta"] = json.dumps(meta)
    stmt = text(
        f"""
        UPDATE graph_exploration
           SET status = 'error',
               error_md = :error_md,
               errors_json = CAST(:errors AS jsonb),
               meta = {meta_sql},
               finished_at = NOW()
         WHERE id = :id
        """
    )
    with session_factory() as session:
        session.execute(stmt, payload)
        session.commit()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def _build_default_s2(vault_schema: str) -> S2Client:
    """Construct a real :class:`S2Client` when the caller didn't inject one.

    Factored out so the orchestrator entry point stays testable: tests
    always pass a mock ``s2`` and this path never runs. The factory
    deliberately does **not** share the httpx client across calls —
    each dive gets its own short-lived client that gets GC'd when the
    ``S2Client`` is dropped.
    """
    # Imports here so tests that mock everything don't need these installed.
    from sqlmodel import Session  # noqa: WPS433

    from research_backend.config import get_settings  # noqa: WPS433
    from research_backend.db import build_engine  # noqa: WPS433

    settings = get_settings()
    engine = build_engine(settings)

    def _session_factory() -> Any:
        return Session(engine)

    http = httpx.AsyncClient(timeout=30.0)
    cache = S2Cache(_session_factory, schema=vault_schema)
    # Share one process-wide TokenBucket across all dives so N concurrent
    # dives can't each allocate their own bucket and multiply the real S2
    # rate limit by N. See research_backend.s2.client for the singleton.
    return S2Client(http, cache, rate_limiter=get_shared_rate_limiter())


async def run_dive(
    *,
    exploration_id: uuid.UUID,
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str = "research_vault",
    s2: S2Client | None = None,
    budget: DiveBudget | None = None,
    summarize_llm: Callable[..., Any] | None = None,
) -> None:
    """Run a full dive for ``exploration_id``.

    See the module docstring for the stepwise contract. This function
    swallows all recoverable errors and records them on the row; the
    only way it can raise is if the DB itself is unreachable from the
    top-level ``_write_error`` call — in which case there's nothing we
    can do from Python and the caller (APScheduler) will log and retry.
    """
    if vault_schema not in _VALID_SCHEMAS:
        raise ValueError(f"invalid vault schema: {vault_schema!r}")

    # ---- Step 1: claim the row ----------------------------------------
    try:
        claimed = await asyncio.to_thread(
            _claim_row, session_factory, exploration_id
        )
    except Exception:
        logger.exception("dive: failed to claim exploration_id=%s", exploration_id)
        raise

    if not claimed:
        logger.info(
            "dive: exploration_id=%s already claimed or missing; skipping",
            exploration_id,
        )
        return

    # Everything below runs inside a try/except so *any* failure lands on
    # the row as status=error with a readable message.
    meta_so_far: dict[str, Any] = {}
    errors: list[dict[str, Any]] = []

    try:
        # ---- Step 2: load row -----------------------------------------
        row = await asyncio.to_thread(_load_row, session_factory, exploration_id)
        if row is None:
            raise DiveError("exploration row vanished after claim")
        seeds_raw: list[str] = row["seed"]
        focus: str = row["focus"]
        row_budget = DiveBudget(
            max_papers=row["budget_papers"],
            max_seconds=row["budget_seconds"],
        )
        effective_budget = budget or row_budget

        # ---- Step 3: construct default S2 if needed -------------------
        if s2 is None:
            s2 = _build_default_s2(vault_schema)

        # ---- Step 4: resolve seeds ------------------------------------
        resolved: list[tuple[int, dict[str, Any]]] = []
        for seed in seeds_raw:
            r = await _resolve_seed(
                s2=s2,
                seed=seed,
                session_factory=session_factory,
                vault_schema=vault_schema,
                exploration_id=exploration_id,
            )
            if r is not None:
                resolved.append(r)
            else:
                errors.append(
                    {"phase": "seed_resolution", "seed": seed, "error": "unresolved"}
                )

        if not resolved:
            raise DiveError(
                "no seeds resolved (received "
                f"{len(seeds_raw)} seed string(s); all failed)"
            )

        seed_source_ids = [sid for sid, _ in resolved]
        seed_papers = [p for _, p in resolved]

        # ---- Step 5: focus embedding (best-effort) --------------------
        focus_embedding: np.ndarray | None = None
        if seed_papers:
            first_s2_id = seed_papers[0].get("paperId")
            if first_s2_id:
                try:
                    emb_resp = await s2.embedding(first_s2_id)
                    vector = ((emb_resp or {}).get("embedding") or {}).get("vector")
                    if isinstance(vector, list) and vector:
                        focus_embedding = np.asarray(vector, dtype=np.float64)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "dive: focus embedding fetch failed s2=%s: %s",
                        first_s2_id,
                        exc,
                    )
                    errors.append(
                        {
                            "phase": "focus_embedding",
                            "s2_paper_id": first_s2_id,
                            "error": repr(exc),
                        }
                    )

        # ---- Step 6: BFS ----------------------------------------------
        try:
            bfs_result: DiveResult = await run_bfs(
                s2=s2,
                session_factory=session_factory,
                vault_schema=vault_schema,
                exploration_id=exploration_id,
                seed_source_ids=seed_source_ids,
                focus=focus,
                focus_embedding=focus_embedding,
                budget=effective_budget,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("dive: BFS failed exploration_id=%s", exploration_id)
            raise DiveError(f"BFS failed: {exc}") from exc

        # Fold BFS's internal errors onto the orchestrator's list so the
        # row's errors_json carries a single unified stream.
        errors.extend(bfs_result.errors)
        meta_so_far = {
            "visited_source_ids": list(bfs_result.visited_source_ids),
            "edge_count": bfs_result.edge_count,
            "s2_requests_used": bfs_result.s2_requests_used,
            "elapsed_seconds": bfs_result.elapsed_seconds,
            "early_terminated": bfs_result.early_terminated,
            "termination_reason": bfs_result.termination_reason,
            "focus": focus,
            "seed_source_ids": list(seed_source_ids),
        }

        # ---- Step 7: clustering --------------------------------------
        clusters: dict[str, Any] = {
            "n_papers": 0,
            "n_clusters": 0,
            "noise_count": 0,
            "clusters": [],
        }
        try:
            clusters = await cluster_exploration(
                s2=s2,
                session_factory=session_factory,
                vault_schema=vault_schema,
                exploration_id=exploration_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "dive: clustering failed exploration_id=%s: %s",
                exploration_id,
                exc,
            )
            errors.append({"phase": "cluster", "error": repr(exc)})

        meta_so_far["n_clusters"] = int(clusters.get("n_clusters") or 0)
        meta_so_far["noise_count"] = int(clusters.get("noise_count") or 0)

        # ---- Step 8: hydrate seeds + visited + cluster top_papers ----
        metadata = await asyncio.to_thread(
            _fetch_visited_metadata,
            session_factory,
            vault_schema,
            list({*seed_source_ids, *bfs_result.visited_source_ids}),
        )

        seeds_for_summary: list[dict[str, Any]] = [
            metadata.get(sid, {"source_id": sid, "title": "(unknown)"})
            for sid in seed_source_ids
        ]
        visited_for_summary: list[dict[str, Any]] = [
            metadata[sid]
            for sid in bfs_result.visited_source_ids
            if sid in metadata
        ]

        # Replace cluster top_papers source_ids with full metadata dicts
        # so the summarizer's ``_format_paper_line`` can render them.
        enriched_cluster_list: list[dict[str, Any]] = []
        for cluster in clusters.get("clusters") or []:
            if not isinstance(cluster, dict):
                continue
            hydrated_tops: list[dict[str, Any]] = []
            for entry in cluster.get("top_papers") or []:
                if isinstance(entry, int) and entry in metadata:
                    hydrated_tops.append(metadata[entry])
                elif isinstance(entry, dict):
                    hydrated_tops.append(entry)
            enriched_cluster_list.append(
                {
                    **cluster,
                    "top_papers": hydrated_tops,
                }
            )
        enriched_clusters = {
            **clusters,
            "clusters": enriched_cluster_list,
        }

        # ---- Step 9: summarize ---------------------------------------
        summary_md: str | None = None
        try:
            summary_md = await summarize_dive(
                seeds=seeds_for_summary,
                visited=visited_for_summary,
                clusters=enriched_clusters,
                focus=focus,
                llm=summarize_llm,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "dive: summarize failed exploration_id=%s: %s",
                exploration_id,
                exc,
            )
            errors.append({"phase": "summarize", "error": repr(exc)})
            summary_md = None

        # ---- Step 10: persist success --------------------------------
        await asyncio.to_thread(
            _write_done,
            session_factory,
            exploration_id,
            summary_md=summary_md,
            meta=meta_so_far,
            errors=errors,
        )
        logger.info(
            "dive: exploration_id=%s done visited=%d edges=%d clusters=%d",
            exploration_id,
            len(bfs_result.visited_source_ids),
            bfs_result.edge_count,
            meta_so_far["n_clusters"],
        )
    except DiveError as exc:
        logger.warning("dive: exploration_id=%s failed: %s", exploration_id, exc)
        await asyncio.to_thread(
            _write_error,
            session_factory,
            exploration_id,
            error_md=str(exc),
            meta=meta_so_far or None,
            errors=errors,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "dive: exploration_id=%s unexpected failure", exploration_id
        )
        await asyncio.to_thread(
            _write_error,
            session_factory,
            exploration_id,
            error_md=f"unexpected: {exc!r}",
            meta=meta_so_far or None,
            errors=errors,
        )



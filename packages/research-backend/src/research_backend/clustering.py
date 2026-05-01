"""HDBSCAN clustering over dive-exploration papers.

Task 3.3 of the academic-research-buddy plan. After a BFS run finishes
(see :mod:`research_backend.dive.bfs`), we want to group the visited
papers into thematic clusters so the downstream LLM summarizer
(Task 3.4) and the graph canvas UI (front-end) can reason about them
as cohesive sub-topics rather than a flat list.

Approach
--------
1. Pull every ``graph_node`` row whose ``source_id`` participated in an
   edge discovered during this exploration. Those are the papers we're
   clustering.
2. Ask S2 for each paper's SPECTER v2 embedding (768-dim dense vector).
   Embeddings are stable per paper so :class:`S2Client.embedding` caches
   for 7 days — repeat runs mostly hit the cache.
3. Drop papers whose embedding is missing / empty (S2 may return ``{}``
   when disabled, or an embedding record with an empty ``vector``).
4. Feed the embedding matrix to HDBSCAN with the caller-specified
   ``min_cluster_size``. HDBSCAN labels noise as ``-1``.
5. Group source_ids by cluster label. For each cluster, sort members by
   ``influence_score`` (descending) and surface the top 5 as
   ``top_papers`` — these are what the LLM summarizer will be given.

Design notes
------------
* **Read-only.** This function does not mutate the database. Callers get
  a plain dict back; persistence (if ever needed) is a separate task's
  problem.
* **CPU-bound HDBSCAN.** The HDBSCAN ``fit_predict`` call is wrapped in
  :func:`asyncio.to_thread` so the event loop stays free while the algo
  crunches the distance graph.
* **Tiny-exploration guard.** With fewer than ``min_cluster_size * 2``
  papers HDBSCAN is virtually guaranteed to return all-noise, so we
  short-circuit and report "zero clusters, all noise" without paying for
  embedding fetches that won't be used. (If you want a synthesis for a
  tiny exploration, just summarize the papers directly.)
* **Idempotency.** Calling this function multiple times yields the same
  (or near-same, modulo HDBSCAN's tie-breaking under equal distances)
  output. Tests set ``np.random.seed`` to keep assertions stable.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any

import hdbscan
import numpy as np
from sqlalchemy import text

from .s2.client import S2Client

logger = logging.getLogger(__name__)

__all__ = ["cluster_exploration"]


_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})
_TOP_PAPERS_PER_CLUSTER = 5


def _fetch_exploration_papers(
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    exploration_id: uuid.UUID,
) -> list[tuple[int, str, float]]:
    """Return ``(source_id, s2_paper_id, influence_score)`` for every
    ``graph_node`` that appears on either end of an edge discovered in
    this exploration.

    We phrase it as "nodes touching an edge from this exploration" rather
    than "nodes with ``first_seen_exploration = :id``" so we also include
    seed papers (which were inserted during previous explorations but
    participate in this exploration's edges).
    """
    query = text(
        f"""
        SELECT DISTINCT gn.source_id,
                        gn.s2_paper_id,
                        COALESCE(gn.influence_score, 0.0) AS influence_score
          FROM {vault_schema}.graph_node gn
         WHERE gn.source_id IN (
             SELECT from_source_id
               FROM {vault_schema}.graph_edge
              WHERE discovered_in = :exploration_id
             UNION
             SELECT to_source_id
               FROM {vault_schema}.graph_edge
              WHERE discovered_in = :exploration_id
         )
           AND gn.s2_paper_id IS NOT NULL
        """
    )
    with session_factory() as session:
        rows = session.execute(query, {"exploration_id": exploration_id}).all()
    return [
        (int(r.source_id), str(r.s2_paper_id), float(r.influence_score))
        for r in rows
    ]


def _extract_vector(response: dict[str, Any]) -> list[float] | None:
    """Pull the embedding vector out of an S2 embedding response.

    Returns ``None`` when the response is empty (disabled S2, 404, etc.)
    or the vector is empty / malformed.
    """
    if not response:
        return None
    embedding = response.get("embedding")
    if not isinstance(embedding, dict):
        return None
    vector = embedding.get("vector")
    if not isinstance(vector, list) or not vector:
        return None
    return vector


async def cluster_exploration(
    *,
    s2: S2Client,
    session_factory: Callable[[], AbstractContextManager[Any]],
    vault_schema: str,
    exploration_id: uuid.UUID,
    min_cluster_size: int = 3,
) -> dict:
    """Cluster every paper visited in an exploration.

    Parameters
    ----------
    s2:
        S2 client used to fetch per-paper embeddings.
    session_factory:
        Context-manager factory producing a SQLAlchemy session; one
        session is opened to fetch the candidate set.
    vault_schema:
        Either ``"research_vault"`` or ``"personal_vault"``.
    exploration_id:
        The ``graph_exploration.id`` whose papers we're clustering.
    min_cluster_size:
        HDBSCAN parameter — minimum points to form a cluster. 3 is a
        reasonable default for small (20-60 paper) explorations.

    Returns
    -------
    dict
        See module docstring for shape. ``n_papers`` counts papers *that
        had usable embeddings* (missing embeddings are dropped). The
        ``clusters`` list excludes the noise label; ``noise_count``
        reports how many papers HDBSCAN assigned to noise (``-1``).
    """
    if vault_schema not in _VALID_SCHEMAS:
        raise ValueError(f"invalid vault schema: {vault_schema!r}")
    if min_cluster_size < 2:
        raise ValueError("min_cluster_size must be >= 2")

    rows = _fetch_exploration_papers(session_factory, vault_schema, exploration_id)
    if not rows:
        return {
            "n_papers": 0,
            "n_clusters": 0,
            "noise_count": 0,
            "clusters": [],
        }

    # Fetch embeddings. Missing/empty responses get dropped — we record
    # the count in the logs so operators can notice persistent holes.
    vectors: list[list[float]] = []
    kept_source_ids: list[int] = []
    kept_influence: list[float] = []
    skipped = 0
    for source_id, s2_paper_id, influence in rows:
        try:
            response = await s2.embedding(s2_paper_id)
        except Exception as exc:  # noqa: BLE001 — don't crash the whole cluster pass
            logger.warning(
                "clustering: embedding fetch failed source_id=%s s2=%s: %s",
                source_id,
                s2_paper_id,
                exc,
            )
            skipped += 1
            continue
        vector = _extract_vector(response)
        if vector is None:
            skipped += 1
            continue
        vectors.append(vector)
        kept_source_ids.append(source_id)
        kept_influence.append(influence)

    if skipped:
        logger.info(
            "clustering: skipped %d/%d papers with missing embeddings",
            skipped,
            len(rows),
        )

    n_papers = len(vectors)

    # With fewer than 2 * min_cluster_size points HDBSCAN cannot produce
    # a non-trivial partition — skip the call entirely and report all-noise.
    if n_papers < min_cluster_size * 2:
        return {
            "n_papers": n_papers,
            "n_clusters": 0,
            "noise_count": n_papers,
            "clusters": [],
        }

    embeddings = np.asarray(vectors, dtype=np.float64)

    # HDBSCAN is CPU-bound — off the event loop.
    labels: np.ndarray = await asyncio.to_thread(
        _run_hdbscan, embeddings, min_cluster_size
    )

    noise_count = int(np.sum(labels == -1))
    clusters: list[dict[str, Any]] = []
    unique_labels = sorted({int(label) for label in labels if label != -1})
    for label in unique_labels:
        members = [
            (kept_source_ids[i], kept_influence[i])
            for i, lab in enumerate(labels)
            if int(lab) == label
        ]
        # Sort by influence descending, then by source_id ascending for
        # deterministic tie-breaking (influence ties are common on fresh
        # papers with citationCount == 0).
        members.sort(key=lambda t: (-t[1], t[0]))
        paper_source_ids = [sid for sid, _ in members]
        top_papers = paper_source_ids[:_TOP_PAPERS_PER_CLUSTER]
        clusters.append(
            {
                "cluster_id": label,
                "size": len(paper_source_ids),
                "paper_source_ids": paper_source_ids,
                "top_papers": top_papers,
            }
        )

    return {
        "n_papers": n_papers,
        "n_clusters": len(clusters),
        "noise_count": noise_count,
        "clusters": clusters,
    }


def _run_hdbscan(embeddings: np.ndarray, min_cluster_size: int) -> np.ndarray:
    """Run HDBSCAN.fit_predict on the embedding matrix.

    Factored out so tests can monkeypatch or directly exercise it
    without constructing an async context. ``metric="euclidean"`` is the
    right choice for SPECTER v2 — the embeddings already live in a
    normalized dense space where Euclidean distance is meaningful.
    """
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        metric="euclidean",
    )
    return clusterer.fit_predict(embeddings)

"""Semantic search API routes.

Two endpoints provide cosine-similarity search over pre-computed embeddings:

- ``/api/search/thread-memory`` — search across thread rolling summaries
- ``/api/search/papers`` — search across vault paper embeddings

Both embed the query via Ollama, then rank rows by cosine similarity in
Python.  When Ollama is unreachable the endpoints fall back to a simple
text scan (``fallback: true`` in the response).
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, Query, Request
from sqlmodel import Session, text

from research_backend.db import get_session
from research_backend.embeddings import _ollama_embed_single

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])

# Schemas that may be interpolated into SQL.  Anything not in this set is
# rejected before reaching the database, preventing SQL injection via the
# ``schema`` query parameter.
_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})


# ---------------------------------------------------------------------------
# Vector helpers (same logic as schedulers/thread_synergy.py)
# ---------------------------------------------------------------------------


def _decode_vec(buf: bytes | memoryview | None) -> np.ndarray | None:
    if buf is None:
        return None
    if isinstance(buf, memoryview):
        buf = bytes(buf)
    if len(buf) == 0:
        return None
    return np.frombuffer(buf, dtype=np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ---------------------------------------------------------------------------
# GET /api/search/thread-memory
# ---------------------------------------------------------------------------


@router.get("/thread-memory")
def search_thread_memory(
    request: Request,
    query: str = Query(..., min_length=1, description="Search query text"),
    thread_id: str | None = Query(None, description="Optional thread ID filter"),
    limit: int = Query(10, ge=1, le=100, description="Max results"),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Semantic search over thread memory embeddings."""
    settings = request.app.state.settings

    # Embed the query via Ollama.
    query_vec = _ollama_embed_single(
        settings.ollama_base_url,
        settings.ollama_embedding_model,
        query,
        max_retries=1,
    )

    # ---- load thread_memory rows with embeddings ----
    if thread_id is not None:
        rows = session.exec(
            text("""
                SELECT tm.thread_id, tm.rolling_summary_md, tm.embedding,
                       tm.topic_fingerprint, tm.updated_at,
                       rt.title, rt.slug
                  FROM thread_memory tm
                  JOIN research_thread rt ON rt.id = tm.thread_id
                 WHERE tm.embedding IS NOT NULL
                   AND tm.thread_id = :thread_id
            """),
            params={"thread_id": thread_id},
        ).all()
    else:
        rows = session.exec(
            text("""
                SELECT tm.thread_id, tm.rolling_summary_md, tm.embedding,
                       tm.topic_fingerprint, tm.updated_at,
                       rt.title, rt.slug
                  FROM thread_memory tm
                  JOIN research_thread rt ON rt.id = tm.thread_id
                 WHERE tm.embedding IS NOT NULL
            """),
        ).all()

    fallback = query_vec is None

    if fallback:
        # Text-match fallback: simple case-insensitive substring search on
        # the rolling summary.
        query_lower = query.lower()
        scored: list[tuple[float, Any]] = []
        for row in rows:
            summary = row[1] or ""
            if query_lower in summary.lower():
                scored.append((1.0, row))
        scored = scored[:limit]
    else:
        # Cosine similarity ranking.
        scored = []
        for row in rows:
            emb = _decode_vec(row[2])
            if emb is None:
                continue
            score = _cosine(query_vec, emb)
            scored.append((score, row))
        scored.sort(key=lambda t: t[0], reverse=True)
        scored = scored[:limit]

    threads = []
    for score, row in scored:
        threads.append({
            "thread_id": str(row[0]),
            "title": row[5],
            "slug": row[6],
            "rolling_summary_md": row[1],
            "topic_fingerprint": row[3],
            "updated_at": str(row[4]) if row[4] else None,
            "score": round(score, 4),
        })

    return {"threads": threads, "fallback": fallback}


# ---------------------------------------------------------------------------
# GET /api/search/papers
# ---------------------------------------------------------------------------


@router.get("/papers")
def search_papers(
    request: Request,
    query: str = Query(..., min_length=1, description="Search query text"),
    schema: str = Query("research_vault", description="Vault schema name"),
    year_from: int | None = Query(None, description="Filter: minimum publication year"),
    min_influence: float | None = Query(None, description="Filter: minimum influence score"),
    limit: int = Query(20, ge=1, le=100, description="Max results"),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Semantic search over vault paper embeddings."""
    if schema not in _VALID_SCHEMAS:
        return {"error": f"Invalid schema: {schema!r}", "papers": [], "fallback": True}

    settings = request.app.state.settings

    # Embed the query via Ollama.
    query_vec = _ollama_embed_single(
        settings.ollama_base_url,
        settings.ollama_embedding_model,
        query,
        max_retries=1,
    )

    # ---- load papers with embeddings ----
    # Schema name is validated above against the allowlist, so f-string
    # interpolation is safe here.
    rows = session.exec(
        text(f"""
            SELECT s.id, s.title, s.kind, s.url, s.author, s.source_ts,
                   e.vec,
                   gn.s2_paper_id, gn.doi, gn.influence_score
              FROM {schema}.embeddings e
              JOIN {schema}.sources s ON s.id = e.source_id
         LEFT JOIN {schema}.graph_node gn ON gn.source_id = s.id
             WHERE e.model = :model
        """),
        params={"model": settings.ollama_embedding_model},
    ).all()

    fallback = query_vec is None

    if fallback:
        # Text-match fallback.
        query_lower = query.lower()
        scored: list[tuple[float, Any]] = []
        for row in rows:
            title = row[1] or ""
            if query_lower in title.lower():
                scored.append((1.0, row))
        scored = scored[:limit]
    else:
        scored = []
        for row in rows:
            emb = _decode_vec(row[6])
            if emb is None:
                continue
            score = _cosine(query_vec, emb)
            scored.append((score, row))
        scored.sort(key=lambda t: t[0], reverse=True)
        scored = scored[:limit]

    # Apply optional post-filters.
    papers: list[dict[str, Any]] = []
    for score, row in scored:
        source_ts = row[5]
        influence = row[9]

        if year_from is not None and source_ts is not None:
            if source_ts.year < year_from:
                continue
        if min_influence is not None:
            if influence is None or influence < min_influence:
                continue

        papers.append({
            "source_id": row[0],
            "title": row[1],
            "kind": row[2],
            "url": row[3],
            "author": row[4],
            "source_ts": str(source_ts) if source_ts else None,
            "s2_paper_id": row[7],
            "doi": row[8],
            "influence_score": float(influence) if influence is not None else None,
            "score": round(score, 4),
        })

    return {"papers": papers, "fallback": fallback}


# ---------------------------------------------------------------------------
# GET /api/search/notes
# ---------------------------------------------------------------------------


@router.get("/notes")
def search_notes(
    request: Request,
    query: str = Query(..., min_length=1, description="Search query text"),
    thread_id: str | None = Query(None, description="Optional thread ID filter"),
    limit: int = Query(10, ge=1, le=100, description="Max results"),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Semantic search over note embeddings."""
    settings = request.app.state.settings

    # Embed the query via Ollama.
    query_vec = _ollama_embed_single(
        settings.ollama_base_url,
        settings.ollama_embedding_model,
        query,
        max_retries=1,
    )

    # ---- load note_index rows with embeddings ----
    if thread_id is not None:
        rows = session.exec(
            text("""
                SELECT ni.id, ni.thread_id, ni.note_id, ni.title, ni.kind,
                       ni.content_hash, ni.embedding,
                       rt.title as thread_title, rt.slug as thread_slug
                  FROM note_index ni
                  JOIN research_thread rt ON rt.id = ni.thread_id
                 WHERE ni.embedding IS NOT NULL
                   AND ni.thread_id = :thread_id
            """),
            params={"thread_id": thread_id},
        ).all()
    else:
        rows = session.exec(
            text("""
                SELECT ni.id, ni.thread_id, ni.note_id, ni.title, ni.kind,
                       ni.content_hash, ni.embedding,
                       rt.title as thread_title, rt.slug as thread_slug
                  FROM note_index ni
                  JOIN research_thread rt ON rt.id = ni.thread_id
                 WHERE ni.embedding IS NOT NULL
            """),
        ).all()

    fallback = query_vec is None

    if fallback:
        # Text-match fallback: simple case-insensitive substring search on
        # the note title.
        query_lower = query.lower()
        scored: list[tuple[float, Any]] = []
        for row in rows:
            title = row[3] or ""
            if query_lower in title.lower():
                scored.append((1.0, row))
        scored = scored[:limit]
    else:
        # Cosine similarity ranking.
        scored = []
        for row in rows:
            emb = _decode_vec(row[6])
            if emb is None:
                continue
            score = _cosine(query_vec, emb)
            scored.append((score, row))
        scored.sort(key=lambda t: t[0], reverse=True)
        scored = scored[:limit]

    notes = []
    for score, row in scored:
        notes.append({
            "note_index_id": str(row[0]),
            "thread_id": str(row[1]),
            "note_id": row[2],
            "title": row[3],
            "kind": row[4],
            "thread_title": row[7],
            "thread_slug": row[8],
            "score": round(score, 4),
        })

    return {"notes": notes, "fallback": fallback}

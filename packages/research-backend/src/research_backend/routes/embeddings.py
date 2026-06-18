"""Embedding and clustering API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlmodel import Session, text

from research_backend.db import get_session

router = APIRouter(prefix="/api/embeddings", tags=["embeddings"])


class EmbedResponse(BaseModel):
    embedded_count: int
    model: str
    message: str


class ClusterResponse(BaseModel):
    topic_count: int
    message: str


class EmbeddingStats(BaseModel):
    total_sources: int
    embedded_sources: int
    unembedded_sources: int
    model: str
    topic_count: int
    assigned_sources: int


@router.get("/stats")
def get_stats(
    request: Request,
    session: Session = Depends(get_session),
) -> EmbeddingStats:
    """Get embedding and clustering statistics."""
    schema = "research_vault"
    model = request.app.state.settings.ollama_embedding_model

    total = session.exec(text(f"SELECT count(*) FROM {schema}.sources")).scalar_one()
    embedded = session.exec(
        text(f"SELECT count(*) FROM {schema}.embeddings WHERE model = :model"),
        params={"model": model},
    ).scalar_one()
    topic_count = session.exec(text(f"SELECT count(*) FROM {schema}.topics")).scalar_one()
    assigned = session.exec(text(f"SELECT count(*) FROM {schema}.source_topics")).scalar_one()

    return EmbeddingStats(
        total_sources=total,
        embedded_sources=embedded,
        unembedded_sources=total - embedded,
        model=model,
        topic_count=topic_count,
        assigned_sources=assigned,
    )


@router.post("/embed")
def run_embedding(
    request: Request,
    session: Session = Depends(get_session),
) -> EmbedResponse:
    """Embed all un-embedded sources."""
    from research_backend.embeddings import embed_sources

    settings = request.app.state.settings
    count = embed_sources(
        session,
        schema="research_vault",
        ollama_base_url=settings.ollama_base_url,
        model=settings.ollama_embedding_model,
    )
    return EmbedResponse(
        embedded_count=count,
        model=settings.ollama_embedding_model,
        message=f"Embedded {count} sources",
    )


@router.post("/cluster")
def run_clustering(
    request: Request,
    session: Session = Depends(get_session),
) -> ClusterResponse:
    """Run HDBSCAN clustering over embedded sources."""
    from research_backend.clustering import cluster_sources

    settings = request.app.state.settings
    count = cluster_sources(
        session,
        schema="research_vault",
        model=settings.ollama_embedding_model,
    )
    return ClusterResponse(
        topic_count=count,
        message=f"Created {count} topics",
    )


@router.get("/topics")
def list_topics(
    session: Session = Depends(get_session),
) -> list[dict]:
    """List all topics with their source counts."""
    rows = session.exec(
        text("""
            SELECT t.id, t.label, t.source_count, t.created_at
            FROM research_vault.topics t
            ORDER BY t.source_count DESC
        """)
    ).all()
    return [
        {
            "id": r[0],
            "label": r[1],
            "source_count": r[2],
            "created_at": str(r[3]),
        }
        for r in rows
    ]


@router.get("/topics/{topic_id}/sources")
def get_topic_sources(
    topic_id: int,
    session: Session = Depends(get_session),
) -> list[dict]:
    """List sources in a topic."""
    rows = session.exec(
        text("""
            SELECT s.id, s.title, s.kind, st.score
            FROM research_vault.source_topics st
            JOIN research_vault.sources s ON s.id = st.source_id
            WHERE st.topic_id = :topic_id
            ORDER BY st.score DESC
        """),
        params={"topic_id": topic_id},
    ).all()
    return [
        {
            "id": r[0],
            "title": r[1],
            "kind": r[2],
            "score": r[3],
        }
        for r in rows
    ]

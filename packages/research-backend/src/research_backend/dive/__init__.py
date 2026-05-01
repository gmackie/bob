"""Dive worker: priority-driven BFS expansion over the S2 citation graph.

Phase 3 of the academic-research-buddy plan. The package is split into pure
scoring helpers (``priority``) and (eventually) the BFS loop, clustering,
summarization, and REST endpoints. Re-exports the public surface so callers can
import from ``research_backend.dive`` directly.
"""

from .priority import (
    FOCUS_WEIGHTS,
    citation_overlap,
    embedding_sim,
    influence_score,
    priority,
    recency_boost,
    unseen_author_bonus,
)

__all__ = [
    "FOCUS_WEIGHTS",
    "citation_overlap",
    "embedding_sim",
    "influence_score",
    "priority",
    "recency_boost",
    "unseen_author_bonus",
]

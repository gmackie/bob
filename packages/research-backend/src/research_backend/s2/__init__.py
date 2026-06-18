"""Semantic Scholar client, cache, and ingest helpers.

Phase 2 of the academic-research-buddy plan. Re-exports the public surface so
callers can import from ``research_backend.s2`` directly.
"""

from .cache import S2Cache, cache_key
from .client import S2Client
from .ingest import (
    compute_content_hash,
    normalize_graph_node_row,
    normalize_sources_row,
    upsert_s2_paper,
)
from .rate_limit import TokenBucket

__all__ = [
    "S2Cache",
    "S2Client",
    "TokenBucket",
    "cache_key",
    "compute_content_hash",
    "normalize_graph_node_row",
    "normalize_sources_row",
    "upsert_s2_paper",
]

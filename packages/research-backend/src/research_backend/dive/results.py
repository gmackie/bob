"""Versioned persisted dive results, separate from immutable exploration identity."""

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DiveCluster(BaseModel):
    model_config = ConfigDict(extra="allow")
    cluster_id: int
    size: int = Field(ge=0)
    label_terms: list[str] = Field(default_factory=list)
    paper_source_ids: list[int] = Field(default_factory=list)
    top_papers: list[dict[str, Any]] = Field(default_factory=list)


class ClusterSummary(BaseModel):
    model_config = ConfigDict(extra="allow")
    n_papers: int = Field(default=0, ge=0)
    n_clusters: int = Field(default=0, ge=0)
    noise_count: int = Field(default=0, ge=0)
    clusters: list[DiveCluster] = Field(default_factory=list)


class DiveStoredResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    version: Literal["v1"] = "v1"
    visited_source_ids: list[int] = Field(default_factory=list)
    edge_count: int = Field(default=0, ge=0)
    n_clusters: int = Field(default=0, ge=0)
    noise_count: int = Field(default=0, ge=0)
    cluster_summary: ClusterSummary = Field(default_factory=ClusterSummary)
    errors: list[dict[str, Any]] = Field(default_factory=list)
    finished_at: datetime


def persisted_result(meta: dict[str, Any], errors: list[dict[str, Any]]) -> dict[str, Any]:
    return DiveStoredResult.model_validate(
        {
            **meta,
            "version": "v1",
            "errors": errors,
            "finished_at": datetime.now(timezone.utc),
        }
    ).model_dump(mode="json")

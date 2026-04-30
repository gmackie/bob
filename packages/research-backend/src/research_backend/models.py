"""Data models for knowledge base operations."""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class KBConfig:
    """Configuration loaded from kb.yaml."""

    name: str
    description: str
    provider: dict[str, str] = field(default_factory=lambda: {"default": "anthropic", "model": "claude-sonnet-4-6"})
    article_types: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    categories: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=lambda: ["pdf", "markdown", "url", "image"])
    compile: dict[str, Any] = field(default_factory=dict)
    # External source pools the compiler should read alongside the KB's own raw/.
    # Each entry is a {path, filter} dict:
    #   - path: relative to repo root (e.g. "sources/youtube/raw")
    #   - filter: optional dict of frontmatter key/value substrings to match
    # Example:
    #   external_sources:
    #     - path: sources/youtube/raw
    #       filter:
    #         channel: huberman
    external_sources: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> KBConfig:
        with open(path) as f:
            data = yaml.safe_load(f)
        return cls(
            name=data["name"],
            description=data.get("description", ""),
            provider=data.get("provider", {}),
            article_types=data.get("article_types", {}),
            categories=data.get("categories", []),
            sources=data.get("sources", []),
            compile=data.get("compile", {}),
            external_sources=data.get("external_sources", []),
        )


@dataclass
class Source:
    """A raw source document."""

    filename: str
    path: Path
    content_hash: str
    mime_type: str
    ingested_at: str = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())
    text: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    # Which adapter owns this source. Default "file" covers the legacy
    # ingest path (pdf/markdown/url/image). YouTube imports set
    # "youtube_video". Having this field from day one prevents a parallel
    # migration when new source types land.
    source_type: str = "file"


@dataclass
class Article:
    """A compiled wiki article."""

    slug: str
    title: str
    article_type: str
    category: str
    sources: list[str]
    content: str
    last_compiled: str = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())

    @property
    def frontmatter(self) -> str:
        src_list = ", ".join(self.sources)
        return (
            f"---\n"
            f"title: {self.title}\n"
            f"type: {self.article_type}\n"
            f"category: {self.category}\n"
            f"sources: [{src_list}]\n"
            f"last_compiled: {self.last_compiled}\n"
            f"---\n"
        )


@dataclass
class LintIssue:
    """An issue found during wiki linting."""

    severity: str  # "error", "warning", "info"
    article: str
    message: str
    suggestion: str = ""


@dataclass
class QueryResult:
    """Result from a knowledge base query."""

    question: str
    answer: str
    sources_consulted: list[str]
    format: str = "md"


def resolve_kb_root(kbs_dir: Path, name: str) -> Path:
    """Resolve a knowledge base root directory."""
    kb_root = kbs_dir / name
    if not kb_root.exists():
        raise FileNotFoundError(f"Knowledge base '{name}' not found at {kb_root}")
    if not (kb_root / "kb.yaml").exists():
        raise FileNotFoundError(f"No kb.yaml found in {kb_root}")
    return kb_root

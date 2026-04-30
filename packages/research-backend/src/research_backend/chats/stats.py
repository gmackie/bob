"""Stats and frontmatter helpers for normalized chat sources."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


@dataclass
class ChatStats:
    total_conversations: int = 0
    total_messages: int = 0
    providers: list[tuple[str, int]] = field(default_factory=list)
    first_updated: str = ""
    last_updated: str = ""


def read_frontmatter(path: Path) -> dict:
    """Read YAML frontmatter from a note file."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def compute_stats(sources_root: Path) -> ChatStats:
    """Compute summary stats from normalized chat notes."""
    raw_dir = Path(sources_root) / "raw"
    stats = ChatStats()
    provider_counts: Counter[str] = Counter()
    updated_values: list[str] = []

    if not raw_dir.exists():
        return stats

    for note_path in sorted(raw_dir.glob("*.md")):
        frontmatter = read_frontmatter(note_path)
        if frontmatter.get("source_type") != "chat_conversation":
            continue
        stats.total_conversations += 1
        stats.total_messages += int(frontmatter.get("message_count") or 0)
        provider = str(frontmatter.get("provider") or "(unknown)")
        provider_counts[provider] += 1
        updated_at = str(
            frontmatter.get("updated_at") or frontmatter.get("created_at") or ""
        )
        if updated_at:
            updated_values.append(updated_at)

    stats.providers = provider_counts.most_common()
    if updated_values:
        stats.first_updated = min(updated_values)
        stats.last_updated = max(updated_values)
    return stats

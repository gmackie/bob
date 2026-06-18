"""Watch frequency analytics — reads source notes back for stats.

Kept separate from the importer so stats can run without any import state,
and so we can evolve the aggregation without touching the hot path.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .notes import video_note_path  # noqa: F401 (kept for symmetry)

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


@dataclass
class WatchStats:
    total_videos: int = 0
    total_watch_events: int = 0
    music_videos: int = 0
    enriched_videos: int = 0
    top_channels: list[tuple[str, int]] = field(default_factory=list)
    most_rewatched: list[tuple[str, str, int]] = field(default_factory=list)
    watches_per_day: dict[str, int] = field(default_factory=dict)
    first_watch: str = ""
    last_watch: str = ""


def compute_stats(sources_root: Path, *, top_n: int = 10) -> WatchStats:
    raw_dir = Path(sources_root) / "raw"
    stats = WatchStats()
    if not raw_dir.exists():
        return stats

    channel_counter: Counter[str] = Counter()
    rewatches: list[tuple[str, str, int]] = []
    day_counter: Counter[str] = Counter()
    all_timestamps: list[str] = []

    for note_path in sorted(raw_dir.glob("*.md")):
        frontmatter = read_frontmatter(note_path)
        if not frontmatter:
            continue
        if frontmatter.get("source_type") != "youtube_video":
            continue

        stats.total_videos += 1
        watch_timestamps = frontmatter.get("watch_timestamps") or []
        if isinstance(watch_timestamps, list):
            stats.total_watch_events += len(watch_timestamps)
            for ts in watch_timestamps:
                if isinstance(ts, str) and len(ts) >= 10:
                    day_counter[ts[:10]] += 1
                    all_timestamps.append(ts)

        if frontmatter.get("is_music"):
            stats.music_videos += 1
        if frontmatter.get("enrichment_status") not in (None, "metadata_only"):
            stats.enriched_videos += 1

        channel = frontmatter.get("channel") or "(unknown)"
        if isinstance(channel, str):
            channel_counter[channel] += 1

        watch_count = frontmatter.get("watch_count") or 0
        if isinstance(watch_count, int) and watch_count >= 2:
            title = frontmatter.get("title") or frontmatter.get("video_id") or ""
            video_id = frontmatter.get("video_id") or ""
            if isinstance(title, str) and isinstance(video_id, str):
                rewatches.append((video_id, title, watch_count))

    stats.top_channels = channel_counter.most_common(top_n)
    rewatches.sort(key=lambda r: r[2], reverse=True)
    stats.most_rewatched = rewatches[:top_n]
    stats.watches_per_day = dict(day_counter)
    if all_timestamps:
        all_timestamps.sort()
        stats.first_watch = all_timestamps[0]
        stats.last_watch = all_timestamps[-1]
    return stats


def read_frontmatter(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}

"""Data models for YouTube watch history import."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

# YouTube video IDs are exactly 11 characters from [A-Za-z0-9_-].
# Enforced to prevent path traversal and injection when building filenames.
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def is_valid_video_id(video_id: str) -> bool:
    return bool(video_id) and bool(VIDEO_ID_RE.match(video_id))


@dataclass
class WatchEvent:
    """A single watch event from a Takeout export.

    Represents one row in the watch history. Multiple events can reference
    the same video_id; they are merged into a VideoRecord at dedupe time.
    """

    video_id: str
    watched_at: str  # ISO 8601 UTC
    title: str = ""
    url: str = ""
    channel: str = ""
    channel_url: str = ""
    is_music: bool = False
    # Provenance: which Takeout import this event came from.
    import_id: str = ""
    # Raw format tag so we can audit parser behavior later.
    source_format: str = "json"  # "json" or "html"


@dataclass
class VideoRecord:
    """Canonical per-video record built from one or more WatchEvents.

    This is the unit that becomes a source note under sources/youtube/raw/.
    """

    video_id: str
    title: str = ""
    url: str = ""
    channel: str = ""
    channel_url: str = ""
    is_music: bool = False
    watch_timestamps: list[str] = field(default_factory=list)
    takeout_imports: list[str] = field(default_factory=list)
    transcript_status: str = "missing"
    enrichment_status: str = "metadata_only"

    @property
    def watch_count(self) -> int:
        return len(self.watch_timestamps)

    @property
    def first_watched_at(self) -> str:
        return self.watch_timestamps[0] if self.watch_timestamps else ""

    @property
    def last_watched_at(self) -> str:
        return self.watch_timestamps[-1] if self.watch_timestamps else ""

    def merge_event(self, event: WatchEvent) -> None:
        """Fold a new watch event into this record.

        - Appends the timestamp if not already present.
        - Upgrades title/channel metadata only if currently empty.
        - Tracks which Takeout imports contributed.
        """
        if event.watched_at and event.watched_at not in self.watch_timestamps:
            self.watch_timestamps.append(event.watched_at)
            self.watch_timestamps.sort()
        if not self.title and event.title:
            self.title = event.title
        if not self.url and event.url:
            self.url = event.url
        if not self.channel and event.channel:
            self.channel = event.channel
        if not self.channel_url and event.channel_url:
            self.channel_url = event.channel_url
        if event.is_music:
            self.is_music = True
        if event.import_id and event.import_id not in self.takeout_imports:
            self.takeout_imports.append(event.import_id)

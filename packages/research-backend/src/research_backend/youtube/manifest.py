"""JSONL append-only manifest for YouTube imports.

One file: sources/youtube/manifests/events.jsonl

Each line is an event record. Crash-safe (append-only, no locking), auditable
(one row per watch event, per import), and trivially resumable. No three-file
dance; single source of truth for what we've seen.

Event kinds:
- "import_started": {"kind": "import_started", "import_id": ..., "source": ..., "started_at": ...}
- "watch":          {"kind": "watch", "import_id": ..., "video_id": ..., "watched_at": ..., ...}
- "import_finished":{"kind": "import_finished", "import_id": ..., "events": N, "videos": M, "finished_at": ...}
- "enrichment":     {"kind": "enrichment", "video_id": ..., "status": ..., "at": ...}
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .models import WatchEvent

MANIFEST_FILENAME = "events.jsonl"


def manifest_path(sources_root: Path) -> Path:
    """Resolve the manifest file path given sources/youtube/ root."""
    d = sources_root / "manifests"
    d.mkdir(parents=True, exist_ok=True)
    return d / MANIFEST_FILENAME


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append_event(path: Path, record: dict[str, Any]) -> None:
    """Append a single JSONL record, fsyncing for durability."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass  # fsync unsupported (e.g. some network FS) — best effort


def append_import_started(path: Path, *, import_id: str, source: str) -> None:
    append_event(path, {
        "kind": "import_started",
        "import_id": import_id,
        "source": source,
        "started_at": now_iso(),
    })


def append_watch(path: Path, event: WatchEvent) -> None:
    append_event(path, {
        "kind": "watch",
        **asdict(event),
    })


def append_import_finished(
    path: Path, *, import_id: str, events: int, videos: int
) -> None:
    append_event(path, {
        "kind": "import_finished",
        "import_id": import_id,
        "events": events,
        "videos": videos,
        "finished_at": now_iso(),
    })


def append_enrichment(path: Path, *, video_id: str, status: str) -> None:
    append_event(path, {
        "kind": "enrichment",
        "video_id": video_id,
        "status": status,
        "at": now_iso(),
    })


def iter_events(path: Path) -> Iterator[dict[str, Any]]:
    """Stream events out of the manifest. Tolerant of partial last lines."""
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def known_import_ids(path: Path) -> set[str]:
    """Return the set of import_ids that have a matching finished record.

    In-flight imports (started but not finished) are NOT counted — re-running
    them is idempotent and safe because video records merge on video_id.
    """
    started: set[str] = set()
    finished: set[str] = set()
    for record in iter_events(path):
        kind = record.get("kind")
        if kind == "import_started":
            iid = record.get("import_id")
            if iid:
                started.add(iid)
        elif kind == "import_finished":
            iid = record.get("import_id")
            if iid:
                finished.add(iid)
    return finished

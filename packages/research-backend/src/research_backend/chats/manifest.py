"""Append-only JSONL manifest for chat imports."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

MANIFEST_FILENAME = "events.jsonl"


def manifest_path(sources_root: Path) -> Path:
    """Resolve the manifest file path given sources/chats/ root."""
    manifests_dir = sources_root / "manifests"
    manifests_dir.mkdir(parents=True, exist_ok=True)
    return manifests_dir / MANIFEST_FILENAME


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def append_event(path: Path, record: dict[str, Any]) -> None:
    """Append a single JSONL record, fsyncing for durability."""
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
        handle.flush()
        try:
            os.fsync(handle.fileno())
        except OSError:
            pass


def append_import_started(path: Path, *, import_id: str, source: str) -> None:
    append_event(
        path,
        {
            "kind": "import_started",
            "import_id": import_id,
            "source": source,
            "started_at": now_iso(),
        },
    )


def append_conversation(
    path: Path, *, canonical_id: str, provider: str, import_id: str
) -> None:
    append_event(
        path,
        {
            "kind": "conversation",
            "canonical_id": canonical_id,
            "provider": provider,
            "import_id": import_id,
            "at": now_iso(),
        },
    )


def append_import_finished(path: Path, *, import_id: str, conversations: int) -> None:
    append_event(
        path,
        {
            "kind": "import_finished",
            "import_id": import_id,
            "conversations": conversations,
            "finished_at": now_iso(),
        },
    )


def iter_events(path: Path) -> Iterator[dict[str, Any]]:
    """Stream manifest events, skipping malformed partial lines."""
    if not path.exists():
        return
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def known_import_ids(path: Path) -> set[str]:
    """Return finished import IDs for idempotency checks."""
    finished: set[str] = set()
    for event in iter_events(path):
        if event.get("kind") == "import_finished":
            import_id = event.get("import_id")
            if import_id:
                finished.add(str(import_id))
    return finished

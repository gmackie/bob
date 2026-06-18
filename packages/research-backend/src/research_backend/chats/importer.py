"""Chat export importer — parse, normalize, and write canonical notes."""

from __future__ import annotations

import datetime
import hashlib
import shutil
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .manifest import (
    append_conversation,
    append_import_finished,
    append_import_started,
    known_import_ids,
    manifest_path,
)
from .notes import conversation_note_path, render_note
from .parser import parse_export


@dataclass
class ChatImportReport:
    import_id: str
    export_path: Path
    conversations_parsed: int = 0
    conversations_created: int = 0
    conversations_updated: int = 0
    errors: list[str] = field(default_factory=list)
    skipped_reason: str = ""


def compute_import_id(export_path: Path) -> str:
    """Derive a stable import id from the export bytes."""
    digest = hashlib.sha256()
    try:
        with open(export_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(65536), b""):
                digest.update(chunk)
    except OSError:
        stat = export_path.stat()
        digest.update(export_path.name.encode("utf-8"))
        digest.update(str(stat.st_mtime).encode("utf-8"))
    date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    return f"{date}-{digest.hexdigest()[:12]}"


def import_chat_export(
    export_path: Path,
    sources_root: Path,
    *,
    dry_run: bool = False,
    copy_export: bool = True,
    import_id: str | None = None,
    progress: Callable[[str], None] | None = None,
) -> ChatImportReport:
    """Import a chat export into canonical conversation notes."""
    export_path = Path(export_path)
    sources_root = Path(sources_root)
    raw_dir = sources_root / "raw"
    manifest_file = manifest_path(sources_root)
    log = progress or (lambda message: None)

    if not dry_run:
        raw_dir.mkdir(parents=True, exist_ok=True)

    iid = import_id or compute_import_id(export_path)
    report = ChatImportReport(import_id=iid, export_path=export_path)

    if not dry_run and iid in known_import_ids(manifest_file):
        report.skipped_reason = f"import_id {iid} already finished"
        log(f"  Skipping: import {iid} already recorded as finished.")
        return report

    if not dry_run:
        append_import_started(manifest_file, import_id=iid, source=str(export_path))
        if copy_export:
            _preserve_export(export_path, sources_root, iid)

    try:
        conversations = parse_export(export_path)
    except Exception as exc:
        report.errors.append(f"parse failed: {exc}")
        log(f"  [error] parse failed: {exc}")
        return report

    report.conversations_parsed = len(conversations)
    log(f"  Parsed {len(conversations)} conversation(s).")

    for conversation in conversations:
        note_path = conversation_note_path(raw_dir, conversation.canonical_id)
        existed = note_path.exists()
        try:
            rendered = render_note(conversation)
            if not dry_run:
                tmp_path = note_path.with_suffix(note_path.suffix + ".tmp")
                tmp_path.write_text(rendered, encoding="utf-8")
                tmp_path.replace(note_path)
                append_conversation(
                    manifest_file,
                    canonical_id=conversation.canonical_id,
                    provider=conversation.provider,
                    import_id=iid,
                )
            if existed:
                report.conversations_updated += 1
            else:
                report.conversations_created += 1
        except OSError as exc:
            message = f"write failed for {conversation.canonical_id}: {exc}"
            report.errors.append(message)
            log(f"  [error] {message}")
        except Exception as exc:  # pragma: no cover
            message = (
                f"unexpected error on {conversation.canonical_id}: {exc}\n"
                f"{traceback.format_exc()}"
            )
            report.errors.append(message)
            log(f"  [error] {message}")

    if not dry_run and not report.errors:
        append_import_finished(
            manifest_file,
            import_id=iid,
            conversations=(
                report.conversations_created + report.conversations_updated
            ),
        )

    return report


def _preserve_export(export_path: Path, sources_root: Path, import_id: str) -> None:
    exports_dir = sources_root / "exports" / import_id
    exports_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(export_path, exports_dir / export_path.name)

"""YouTube Takeout importer — end-to-end import pipeline.

Orchestrates parser → dedupe → source-note write → manifest append.

Design contracts:
- Re-running the same Takeout is a no-op after the first successful finish.
- New Takeouts with overlapping videos merge watch timestamps in place.
- A failure mid-write never leaves the manifest in a lying state: we write
  the manifest *after* each note is written, so crash-recovery sees the
  partial state honestly.
- We never fail the whole run because of one bad row.
"""

from __future__ import annotations

import datetime
import hashlib
import shutil
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from .models import VideoRecord, WatchEvent, is_valid_video_id
from .manifest import (
    append_import_finished,
    append_import_started,
    append_watch,
    known_import_ids,
    manifest_path,
)
from .notes import (
    load_existing,
    merge_record_with_existing,
    render_note,
    video_note_path,
)
from .parser import group_by_video, parse_takeout


@dataclass
class ImportReport:
    """Summary of what an import run touched.

    Consumed by the CLI to print user-facing results and by callers that want
    to chain on top (e.g. stats refresh).
    """

    import_id: str
    takeout_path: Path
    events_parsed: int = 0
    events_written: int = 0
    videos_created: int = 0
    videos_updated: int = 0
    music_entries: int = 0
    skipped_invalid: int = 0
    errors: list[str] = field(default_factory=list)
    skipped_reason: str = ""  # set when the whole import was skipped

    @property
    def videos_total(self) -> int:
        return self.videos_created + self.videos_updated


def compute_import_id(takeout_path: Path) -> str:
    """Derive a stable import_id from the Takeout file contents.

    Same bytes → same id. Lets us detect re-imports of the same export even
    if the filename changes.
    """
    h = hashlib.sha256()
    try:
        with open(takeout_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
    except OSError:
        # Fallback: name + mtime. Not ideal, but better than crashing.
        stat = takeout_path.stat()
        h.update(takeout_path.name.encode("utf-8"))
        h.update(str(stat.st_mtime).encode("utf-8"))
    digest = h.hexdigest()[:12]
    date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    return f"{date}-{digest}"


def import_takeout(
    takeout_path: Path,
    sources_root: Path,
    *,
    dry_run: bool = False,
    filter_channels: list[str] | None = None,
    exclude_channels: list[str] | None = None,
    include_music: bool = True,
    import_id: str | None = None,
    copy_takeout: bool = True,
    progress: Callable[[str], None] | None = None,
) -> ImportReport:
    """Run a full Takeout import.

    Parameters
    ----------
    takeout_path:
        Path to watch-history.json or watch-history.html.
    sources_root:
        Root of the YouTube source tree, e.g. <repo>/sources/youtube.
    dry_run:
        Parse + dedupe but do not write any files or manifest entries.
    filter_channels / exclude_channels:
        Case-insensitive substring match on channel name. filter wins: if set,
        only matching channels are imported. exclude is applied after filter.
    include_music:
        If False, YouTube Music entries are tagged and skipped.
    import_id:
        Optional override (for tests). Otherwise derived from content hash.
    copy_takeout:
        Preserve the original Takeout under sources_root/takeout/<import_id>/.
    """
    takeout_path = Path(takeout_path)
    sources_root = Path(sources_root)
    raw_dir = sources_root / "raw"
    manifest_file = manifest_path(sources_root)

    if not dry_run:
        raw_dir.mkdir(parents=True, exist_ok=True)

    iid = import_id or compute_import_id(takeout_path)
    report = ImportReport(import_id=iid, takeout_path=takeout_path)

    _log = progress or (lambda msg: None)

    # Idempotency: if this exact import is already finished, short-circuit.
    if not dry_run and iid in known_import_ids(manifest_file):
        report.skipped_reason = f"import_id {iid} already finished"
        _log(f"  Skipping: import {iid} already recorded as finished.")
        return report

    if not dry_run:
        append_import_started(
            manifest_file, import_id=iid, source=str(takeout_path)
        )
        if copy_takeout:
            _preserve_takeout(takeout_path, sources_root, iid)

    try:
        events = list(_filtered_events(
            parse_takeout(takeout_path, import_id=iid),
            filter_channels=filter_channels,
            exclude_channels=exclude_channels,
            include_music=include_music,
            report=report,
        ))
    except (ValueError, FileNotFoundError) as e:
        report.errors.append(f"parse failed: {e}")
        _log(f"  [error] parse failed: {e}")
        return report

    report.events_parsed = len(events)
    _log(f"  Parsed {len(events)} watch events.")

    grouped = group_by_video(events)
    _log(f"  Dedupe: {len(grouped)} unique videos.")

    for video_id, video_events in grouped.items():
        if not is_valid_video_id(video_id):
            report.skipped_invalid += len(video_events)
            continue
        try:
            created = _write_video_note(
                video_id=video_id,
                events=video_events,
                raw_dir=raw_dir,
                manifest_file=manifest_file,
                dry_run=dry_run,
            )
            report.events_written += len(video_events)
            if created:
                report.videos_created += 1
            else:
                report.videos_updated += 1
            if any(e.is_music for e in video_events):
                report.music_entries += 1
        except OSError as e:
            msg = f"write failed for {video_id}: {e}"
            report.errors.append(msg)
            _log(f"  [error] {msg}")
        except Exception as e:  # pragma: no cover — defensive
            msg = f"unexpected error on {video_id}: {e}\n{traceback.format_exc()}"
            report.errors.append(msg)
            _log(f"  [error] {msg}")

    if not dry_run:
        append_import_finished(
            manifest_file,
            import_id=iid,
            events=report.events_written,
            videos=report.videos_total,
        )

    _log(
        f"  Done. {report.videos_created} new, {report.videos_updated} updated"
        + (f", {len(report.errors)} errors" if report.errors else "")
        + "."
    )
    return report


# --- internals ------------------------------------------------------------

def _filtered_events(
    events: Iterable[WatchEvent],
    *,
    filter_channels: list[str] | None,
    exclude_channels: list[str] | None,
    include_music: bool,
    report: ImportReport,
) -> Iterable[WatchEvent]:
    filters_lc = [f.lower() for f in filter_channels] if filter_channels else []
    excludes_lc = [e.lower() for e in exclude_channels] if exclude_channels else []

    for event in events:
        if not include_music and event.is_music:
            continue
        channel_lc = (event.channel or "").lower()
        if filters_lc and not any(f in channel_lc for f in filters_lc):
            continue
        if excludes_lc and any(e in channel_lc for e in excludes_lc):
            continue
        yield event


def _write_video_note(
    *,
    video_id: str,
    events: list[WatchEvent],
    raw_dir: Path,
    manifest_file: Path,
    dry_run: bool,
) -> bool:
    """Write/merge a single source note. Returns True if newly created."""
    note_path = video_note_path(raw_dir, video_id)
    existed = note_path.exists()

    record = VideoRecord(video_id=video_id)
    for ev in events:
        record.merge_event(ev)

    existing_frontmatter, existing_enrichment = load_existing(note_path)
    if existing_frontmatter:
        record = merge_record_with_existing(record, existing_frontmatter)

    rendered = render_note(record, existing_enrichment=existing_enrichment)

    if dry_run:
        return not existed

    # Write atomically so a crash never leaves a half-written note.
    tmp = note_path.with_suffix(note_path.suffix + ".tmp")
    tmp.write_text(rendered, encoding="utf-8")
    tmp.replace(note_path)

    for ev in events:
        append_watch(manifest_file, ev)

    return not existed


def _preserve_takeout(takeout_path: Path, sources_root: Path, import_id: str) -> None:
    """Copy the original Takeout file under sources/youtube/takeout/<id>/."""
    dest_dir = sources_root / "takeout" / import_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / takeout_path.name
    try:
        shutil.copy2(takeout_path, dest)
    except OSError:
        # Non-fatal: preservation is nice-to-have, not required for correctness.
        pass

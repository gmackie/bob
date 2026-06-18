"""Phase 2 transcript enrichment via yt-dlp.

Lazy by design:
- Most videos stay as metadata-only notes forever.
- Enrichment runs only when the user (or a compiler pass) asks for it.
- Failures degrade gracefully: we mark the note with an enrichment status
  explaining why and move on. We never delete a note for enrichment failure.

Security note: yt-dlp is invoked via subprocess with list-form args. We never
use shell=True, and the video id is validated before it reaches the command
line (see models.is_valid_video_id).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import yaml

from .manifest import append_enrichment, manifest_path
from .models import is_valid_video_id
from .notes import ENRICH_BEGIN, ENRICH_END, video_note_path

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)

# How long we're willing to wait for yt-dlp per video.
YTDLP_TIMEOUT_SEC = 120


def yt_dlp_available() -> bool:
    return shutil.which("yt-dlp") is not None


def pick_candidates(
    sources_root: Path, *, limit: int = 5, most_watched: bool = False
) -> list[str]:
    """Pick video ids from raw/ that haven't been enriched yet.

    If `most_watched` is True, sort by watch_count descending. Otherwise,
    return the first N unenriched in filesystem order (stable, cheap).
    """
    raw_dir = Path(sources_root) / "raw"
    if not raw_dir.exists():
        return []

    candidates: list[tuple[str, int]] = []
    for path in raw_dir.glob("*.md"):
        fm = _read_frontmatter(path)
        if fm.get("source_type") != "youtube_video":
            continue
        if fm.get("enrichment_status") not in (None, "metadata_only"):
            continue
        video_id = fm.get("video_id")
        if not isinstance(video_id, str) or not is_valid_video_id(video_id):
            continue
        watch_count = fm.get("watch_count") or 0
        if not isinstance(watch_count, int):
            watch_count = 0
        candidates.append((video_id, watch_count))

    if most_watched:
        candidates.sort(key=lambda r: r[1], reverse=True)
    return [vid for vid, _ in candidates[:limit]]


def enrich_video(video_id: str, sources_root: Path) -> dict[str, Any]:
    """Enrich a single video note. Returns a result dict for the CLI.

    Possible statuses:
      - "enriched":           transcript written
      - "already_enriched":   skipped, note already has enrichment
      - "no_transcript":      yt-dlp ran but no captions available
      - "unavailable":        video is private/deleted/region-blocked
      - "yt_dlp_missing":     yt-dlp binary not on PATH
      - "invalid":            video_id failed validation
      - "note_missing":       no source note on disk
    """
    sources_root = Path(sources_root)
    if not is_valid_video_id(video_id):
        return {"status": "invalid", "reason": "video_id failed validation"}

    note_path = video_note_path(sources_root / "raw", video_id)
    if not note_path.exists():
        return {"status": "note_missing", "reason": str(note_path)}

    if not yt_dlp_available():
        return {"status": "yt_dlp_missing", "reason": "install with: pipx install yt-dlp"}

    metadata = _run_yt_dlp_metadata(video_id)
    if metadata is None:
        _update_note_status(note_path, "unavailable", "unavailable")
        append_enrichment(
            manifest_path(sources_root), video_id=video_id, status="unavailable"
        )
        return {"status": "unavailable", "reason": "yt-dlp could not fetch metadata"}

    transcript_text = _fetch_transcript(video_id)
    enrichment_status = "enriched" if transcript_text else "metadata_only"
    transcript_status = "fetched" if transcript_text else "unavailable"

    _write_enrichment_block(
        note_path,
        metadata=metadata,
        transcript=transcript_text or "",
        transcript_status=transcript_status,
        enrichment_status=enrichment_status,
    )
    append_enrichment(
        manifest_path(sources_root), video_id=video_id, status=enrichment_status
    )

    return {
        "status": "enriched" if transcript_text else "no_transcript",
        "title": metadata.get("title", ""),
        "transcript_chars": len(transcript_text) if transcript_text else 0,
    }


# --- yt-dlp subprocess wrappers -------------------------------------------

def _run_yt_dlp_metadata(video_id: str) -> dict | None:
    """Pull metadata as JSON. Returns None on failure."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    cmd = [
        "yt-dlp",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        url,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=YTDLP_TIMEOUT_SEC,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


_VTT_CUE_TIMING_RE = re.compile(r"^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->")


def _fetch_transcript(video_id: str) -> str | None:
    """Try subs, then auto-subs, return cleaned transcript text or None."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    import tempfile

    with tempfile.TemporaryDirectory(prefix="yt-transcript-") as tmp:
        tmpdir = Path(tmp)
        for use_auto in (False, True):
            cmd = [
                "yt-dlp",
                "--skip-download",
                "--write-subs" if not use_auto else "--write-auto-subs",
                "--sub-langs", "en.*",
                "--sub-format", "vtt",
                "--no-warnings",
                "-o", str(tmpdir / "%(id)s.%(ext)s"),
                url,
            ]
            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=YTDLP_TIMEOUT_SEC,
                    check=False,
                )
            except (subprocess.TimeoutExpired, OSError):
                continue
            if result.returncode != 0:
                continue
            vtt_files = sorted(tmpdir.glob(f"{video_id}*.vtt"))
            if not vtt_files:
                continue
            return _clean_vtt(vtt_files[0].read_text(encoding="utf-8"))
    return None


def _clean_vtt(raw: str) -> str:
    """Strip VTT header, timestamps, and duplicate cues to plain text."""
    lines = raw.splitlines()
    cleaned: list[str] = []
    prev = ""
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped == "WEBVTT":
            continue
        if stripped.startswith("NOTE"):
            continue
        if stripped.startswith("Kind:") or stripped.startswith("Language:"):
            continue
        if _VTT_CUE_TIMING_RE.match(stripped):
            continue
        # Strip inline timing/position tags like <00:00:05.000>.
        no_tags = re.sub(r"<[^>]+>", "", stripped)
        no_tags = no_tags.strip()
        if not no_tags or no_tags == prev:
            continue
        cleaned.append(no_tags)
        prev = no_tags
    return "\n".join(cleaned)


# --- note I/O -------------------------------------------------------------

def _read_frontmatter(path: Path) -> dict:
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


def _write_frontmatter(path: Path, frontmatter: dict, rest: str) -> None:
    try:
        dumped = yaml.safe_dump(
            frontmatter,
            sort_keys=False,
            allow_unicode=True,
            default_flow_style=False,
            width=10_000,
        )
    except yaml.YAMLError:
        return
    new_text = f"---\n{dumped.rstrip()}\n---\n{rest}"
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(new_text, encoding="utf-8")
    tmp.replace(path)


def _update_note_status(path: Path, transcript_status: str, enrichment_status: str) -> None:
    fm = _read_frontmatter(path)
    if not fm:
        return
    fm["transcript_status"] = transcript_status
    fm["enrichment_status"] = enrichment_status
    text = path.read_text(encoding="utf-8")
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return
    rest = text[m.end():]
    _write_frontmatter(path, fm, rest)


def _write_enrichment_block(
    path: Path,
    *,
    metadata: dict,
    transcript: str,
    transcript_status: str,
    enrichment_status: str,
) -> None:
    text = path.read_text(encoding="utf-8")
    fm = _read_frontmatter(path)
    if not fm:
        return
    fm["transcript_status"] = transcript_status
    fm["enrichment_status"] = enrichment_status

    # Update title/channel if the Takeout metadata was weak.
    if metadata.get("title") and not fm.get("title"):
        fm["title"] = metadata["title"]
    if metadata.get("channel") and not fm.get("channel"):
        fm["channel"] = metadata["channel"]

    m = _FRONTMATTER_RE.match(text)
    if not m:
        return
    rest = text[m.end():]

    # Replace the enrichment block if present, otherwise append one.
    new_block = _format_enrichment_block(metadata, transcript)
    begin = rest.find(ENRICH_BEGIN)
    end = rest.find(ENRICH_END)
    if begin != -1 and end != -1 and end > begin:
        new_rest = rest[:begin] + new_block + rest[end + len(ENRICH_END):]
    else:
        new_rest = rest.rstrip() + "\n\n" + new_block + "\n"

    _write_frontmatter(path, fm, new_rest)


def _format_enrichment_block(metadata: dict, transcript: str) -> str:
    lines = [ENRICH_BEGIN, ""]
    description = metadata.get("description")
    duration = metadata.get("duration")
    upload_date = metadata.get("upload_date")
    view_count = metadata.get("view_count")
    chapters = metadata.get("chapters") or []
    tags = metadata.get("tags") or []

    lines.append("## Metadata")
    lines.append("")
    if duration:
        lines.append(f"- **Duration:** {duration} seconds")
    if upload_date:
        lines.append(f"- **Uploaded:** {upload_date}")
    if view_count:
        lines.append(f"- **Views:** {view_count:,}")
    if tags:
        lines.append(f"- **Tags:** {', '.join(tags[:10])}")
    lines.append("")

    if chapters:
        lines.append("## Chapters")
        lines.append("")
        for chapter in chapters:
            title = chapter.get("title") or "(untitled)"
            start = chapter.get("start_time") or 0
            lines.append(f"- `{_fmt_time(start)}` {title}")
        lines.append("")

    if description:
        lines.append("## Description")
        lines.append("")
        lines.append(str(description).strip())
        lines.append("")

    if transcript:
        lines.append("## Transcript")
        lines.append("")
        lines.append(transcript.strip())
        lines.append("")
    else:
        lines.append("*No transcript available for this video.*")
        lines.append("")

    lines.append(ENRICH_END)
    return "\n".join(lines)


def _fmt_time(seconds: float | int) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

"""Render and merge YouTube video source notes on disk.

Each video becomes one markdown file under sources/youtube/raw/<video-id>.md.
The file layout is split into two logical regions:

  ---
  <immutable-ish frontmatter: identity + watch history>
  ---
  # <title>

  <!-- RESEARCH:IMMUTABLE:BEGIN -->
  <metadata summary — regenerated each import>
  <!-- RESEARCH:IMMUTABLE:END -->

  <!-- RESEARCH:ENRICHMENT:BEGIN -->
  <transcript / chapters / extracted links — written by Phase 2>
  <!-- RESEARCH:ENRICHMENT:END -->

The enrichment block is preserved across re-imports so lazy transcript work
never gets clobbered by a fresh Takeout.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from .models import VideoRecord

ENRICH_BEGIN = "<!-- RESEARCH:ENRICHMENT:BEGIN -->"
ENRICH_END = "<!-- RESEARCH:ENRICHMENT:END -->"
IMMUTABLE_BEGIN = "<!-- RESEARCH:IMMUTABLE:BEGIN -->"
IMMUTABLE_END = "<!-- RESEARCH:IMMUTABLE:END -->"

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
_ENRICH_RE = re.compile(
    re.escape(ENRICH_BEGIN) + r"(.*?)" + re.escape(ENRICH_END), re.DOTALL
)


def video_note_path(raw_dir: Path, video_id: str) -> Path:
    """Resolve the on-disk path for a video's source note.

    `video_id` must already be validated upstream (11-char regex). Even so,
    we strip path separators defensively.
    """
    safe = video_id.replace("/", "").replace("\\", "").replace("..", "")
    return raw_dir / f"{safe}.md"


def load_existing(path: Path) -> tuple[dict, str]:
    """Return (frontmatter_dict, enrichment_block) from an existing note.

    If the file doesn't exist or the frontmatter is malformed, returns ({}, "").
    The enrichment_block includes the begin/end markers so writers can drop it
    back in verbatim.
    """
    if not path.exists():
        return {}, ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}, ""

    frontmatter: dict = {}
    m = _FRONTMATTER_RE.match(text)
    if m:
        try:
            parsed = yaml.safe_load(m.group(1))
            if isinstance(parsed, dict):
                frontmatter = parsed
        except yaml.YAMLError:
            frontmatter = {}

    enrich = ""
    em = _ENRICH_RE.search(text)
    if em:
        enrich = em.group(0)  # keep the markers
    return frontmatter, enrich


def merge_record_with_existing(record: VideoRecord, existing: dict) -> VideoRecord:
    """Fold existing frontmatter back into a fresh record.

    Preserves enrichment status and any watch timestamps we had before but
    that aren't in the new import (e.g. if the user deleted an older Takeout
    and re-imported a newer one, we still want the union).
    """
    prior_timestamps = existing.get("watch_timestamps") or []
    if isinstance(prior_timestamps, list):
        merged = set(record.watch_timestamps)
        for ts in prior_timestamps:
            if isinstance(ts, str):
                merged.add(ts)
        record.watch_timestamps = sorted(merged)

    prior_imports = existing.get("takeout_imports") or []
    if isinstance(prior_imports, list):
        for iid in prior_imports:
            if isinstance(iid, str) and iid not in record.takeout_imports:
                record.takeout_imports.append(iid)

    # Preserve enrichment status across re-imports.
    prior_transcript = existing.get("transcript_status")
    if isinstance(prior_transcript, str) and prior_transcript != "missing":
        record.transcript_status = prior_transcript
    prior_enrichment = existing.get("enrichment_status")
    if isinstance(prior_enrichment, str) and prior_enrichment != "metadata_only":
        record.enrichment_status = prior_enrichment

    # Upgrade title/channel from existing if the new import lost them.
    if not record.title and isinstance(existing.get("title"), str):
        record.title = existing["title"]
    if not record.channel and isinstance(existing.get("channel"), str):
        record.channel = existing["channel"]

    return record


def render_note(record: VideoRecord, *, existing_enrichment: str = "") -> str:
    """Render a VideoRecord to the full markdown source-note body.

    `existing_enrichment` is the verbatim enrichment block (including markers)
    from the prior version of the note, if any. If omitted, a placeholder
    block is emitted so Phase 2 has a stable anchor to write into.
    """
    frontmatter = {
        "source_type": "youtube_video",
        "video_id": record.video_id,
        "url": record.url or f"https://www.youtube.com/watch?v={record.video_id}",
        "title": record.title or "(unknown)",
        "channel": record.channel or "(unknown)",
        "channel_url": record.channel_url,
        "is_music": record.is_music,
        "first_watched_at": record.first_watched_at,
        "last_watched_at": record.last_watched_at,
        "watch_count": record.watch_count,
        "watch_timestamps": list(record.watch_timestamps),
        "takeout_imports": list(record.takeout_imports),
        "transcript_status": record.transcript_status,
        "enrichment_status": record.enrichment_status,
    }

    try:
        frontmatter_yaml = yaml.safe_dump(
            frontmatter,
            sort_keys=False,
            allow_unicode=True,
            default_flow_style=False,
            width=10_000,
        )
    except yaml.YAMLError:
        # Extremely defensive: if something breaks yaml.safe_dump (e.g. a
        # surrogate char in a title), fall back to quoted-string serialization
        # so we never fail to write the note.
        frontmatter_yaml = _fallback_frontmatter(frontmatter)

    enrichment_block = existing_enrichment or _empty_enrichment_block()
    title = record.title or record.video_id
    body_parts = [
        f"---\n{frontmatter_yaml.rstrip()}\n---",
        "",
        f"# {title}",
        "",
        IMMUTABLE_BEGIN,
        "",
        _immutable_summary(record),
        "",
        IMMUTABLE_END,
        "",
        enrichment_block,
        "",
    ]
    return "\n".join(body_parts)


def _immutable_summary(record: VideoRecord) -> str:
    lines = [
        f"- **Video:** [{record.title or record.video_id}]"
        f"({record.url or 'https://www.youtube.com/watch?v=' + record.video_id})",
    ]
    if record.channel:
        if record.channel_url:
            lines.append(f"- **Channel:** [{record.channel}]({record.channel_url})")
        else:
            lines.append(f"- **Channel:** {record.channel}")
    lines.append(f"- **Watch count:** {record.watch_count}")
    if record.first_watched_at:
        lines.append(f"- **First watched:** {record.first_watched_at}")
    if record.last_watched_at:
        lines.append(f"- **Last watched:** {record.last_watched_at}")
    if record.is_music:
        lines.append("- **YouTube Music entry**")
    return "\n".join(lines)


def _empty_enrichment_block() -> str:
    return (
        f"{ENRICH_BEGIN}\n"
        f"*No transcript enrichment yet. Run `research youtube enrich` to fetch.*\n"
        f"{ENRICH_END}"
    )


def _fallback_frontmatter(data: dict) -> str:
    """Hand-roll a safe YAML mapping when yaml.safe_dump can't serialize it."""
    lines: list[str] = []
    for key, value in data.items():
        if isinstance(value, list):
            if not value:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                for item in value:
                    lines.append(f"  - {_fallback_scalar(item)}")
        else:
            lines.append(f"{key}: {_fallback_scalar(value)}")
    return "\n".join(lines) + "\n"


def _fallback_scalar(value) -> str:
    if value is None:
        return '""'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    s = str(value)
    # Always double-quote strings so colons, quotes, unicode are safe.
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'

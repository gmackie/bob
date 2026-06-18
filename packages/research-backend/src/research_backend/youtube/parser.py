"""Google Takeout watch-history parser.

Supports both formats Google ships in the wild:
- JSON:  Takeout/YouTube and YouTube Music/history/watch-history.json
- HTML:  Takeout/YouTube and YouTube Music/history/watch-history.html

Parsing is lenient: Takeout schemas drift across exports. Unknown fields
are tolerated, missing fields degrade gracefully. We never drop a row just
because metadata is incomplete — the canonical unit is the video id.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Iterator

from .models import WatchEvent, is_valid_video_id

# Large-file warning threshold. json.load() is fine up to ~50-100MB in practice,
# beyond that we want the user to know what they're doing before we load it.
LARGE_FILE_WARN_BYTES = 100 * 1024 * 1024  # 100 MB

_VIDEO_URL_RE = re.compile(r"(?:v=|youtu\.be/|youtube\.com/watch\?v=)([A-Za-z0-9_-]{11})")
_SHORTS_URL_RE = re.compile(r"youtube\.com/shorts/([A-Za-z0-9_-]{11})")
_CHANNEL_URL_RE = re.compile(r"youtube\.com/channel/([A-Za-z0-9_-]+)")


def extract_video_id(url: str) -> str:
    """Pull the 11-char video id out of a YouTube URL, or "" if none found."""
    if not url:
        return ""
    m = _VIDEO_URL_RE.search(url)
    if m:
        return m.group(1)
    m = _SHORTS_URL_RE.search(url)
    if m:
        return m.group(1)
    return ""


def parse_takeout(path: Path, *, import_id: str) -> Iterator[WatchEvent]:
    """Parse a Takeout watch-history file (JSON or HTML).

    Yields WatchEvents. Invalid rows are skipped, not raised.
    Callers should handle FileNotFoundError and OSError.
    """
    if not path.exists():
        raise FileNotFoundError(f"Takeout file not found: {path}")

    size = path.stat().st_size
    if size > LARGE_FILE_WARN_BYTES:
        print(
            f"  [warn] Takeout file is {size / 1024 / 1024:.1f} MB. "
            f"Loading into memory. This may be slow."
        )

    suffix = path.suffix.lower()
    if suffix == ".json":
        yield from _parse_json(path, import_id=import_id)
    elif suffix in (".html", ".htm"):
        yield from _parse_html(path, import_id=import_id)
    else:
        raise ValueError(
            f"Unsupported Takeout format '{suffix}'. Expected .json or .html."
        )


# --- JSON parsing ---------------------------------------------------------

def _parse_json(path: Path, *, import_id: str) -> Iterator[WatchEvent]:
    """Parse the JSON variant of watch-history.

    Schema (as of 2024-2026 exports):
        [
          {
            "header": "YouTube",  # or "YouTube Music"
            "title": "Watched <video title>",
            "titleUrl": "https://www.youtube.com/watch?v=...",
            "subtitles": [{"name": "channel", "url": "..."}],
            "time": "2026-04-01T08:42:00.000Z",
            ...
          },
          ...
        ]
    """
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"Malformed Takeout JSON: {e}") from e

    if not isinstance(data, list):
        raise ValueError("Takeout JSON root must be a list of watch events.")

    for row in data:
        if not isinstance(row, dict):
            continue
        event = _event_from_json_row(row, import_id=import_id)
        if event is not None:
            yield event


def _event_from_json_row(row: dict, *, import_id: str) -> WatchEvent | None:
    url = row.get("titleUrl", "") or ""
    video_id = extract_video_id(url)
    if not is_valid_video_id(video_id):
        # Surveys, ads, channel-page visits — not video watches. Skip.
        return None

    title = row.get("title", "") or ""
    # Takeout prefixes with "Watched " — strip for a clean title.
    if title.startswith("Watched "):
        title = title[len("Watched "):]

    subtitles = row.get("subtitles") or []
    channel = ""
    channel_url = ""
    if isinstance(subtitles, list) and subtitles:
        first = subtitles[0]
        if isinstance(first, dict):
            channel = first.get("name", "") or ""
            channel_url = first.get("url", "") or ""

    watched_at = _normalize_timestamp(row.get("time", ""))
    header = (row.get("header", "") or "").lower()
    is_music = "music" in header

    return WatchEvent(
        video_id=video_id,
        watched_at=watched_at,
        title=title,
        url=url,
        channel=channel,
        channel_url=channel_url,
        is_music=is_music,
        import_id=import_id,
        source_format="json",
    )


def _normalize_timestamp(raw: str) -> str:
    """Coerce Takeout's ISO timestamp to RFC3339 UTC with a Z suffix."""
    if not raw:
        return ""
    try:
        # Python's fromisoformat accepts "Z" as of 3.11.
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, TypeError):
        return raw  # preserve as-is so downstream can still see it


# --- HTML parsing ---------------------------------------------------------

class _WatchHistoryHTMLParser(HTMLParser):
    """Streaming extractor for Takeout's HTML variant.

    The HTML is a huge list of .outer-cell / .content-cell blocks. We pull
    text and anchors per cell and synthesize a WatchEvent.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict] = []
        self._in_cell = False
        self._cell_depth = 0
        self._current_text: list[str] = []
        self._current_links: list[tuple[str, str]] = []
        self._in_anchor = False
        self._anchor_href = ""
        self._anchor_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        cls = (attr.get("class") or "").lower()
        if "content-cell" in cls and "mdl-typography--body-1" in cls:
            self._in_cell = True
            self._cell_depth = 1
            self._current_text = []
            self._current_links = []
            return
        if self._in_cell:
            if tag in ("div", "span", "p"):
                self._cell_depth += 1
            if tag == "a":
                self._in_anchor = True
                self._anchor_href = attr.get("href") or ""
                self._anchor_text = []
            elif tag == "br":
                self._current_text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self._in_cell:
            return
        if tag == "a" and self._in_anchor:
            href = self._anchor_href
            text = "".join(self._anchor_text).strip()
            self._current_links.append((href, text))
            self._current_text.append(text)
            self._in_anchor = False
            self._anchor_href = ""
            self._anchor_text = []
            return
        if tag in ("div", "span", "p"):
            self._cell_depth -= 1
            if self._cell_depth <= 0:
                self.rows.append({
                    "text": "".join(self._current_text),
                    "links": list(self._current_links),
                })
                self._in_cell = False
                self._cell_depth = 0
                self._current_text = []
                self._current_links = []

    def handle_data(self, data: str) -> None:
        if not self._in_cell:
            return
        if self._in_anchor:
            self._anchor_text.append(data)
        else:
            self._current_text.append(data)


_HTML_TIMESTAMP_RE = re.compile(
    r"(\w{3}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s*[APap][Mm])"
)


def _parse_html(path: Path, *, import_id: str) -> Iterator[WatchEvent]:
    parser = _WatchHistoryHTMLParser()
    try:
        parser.feed(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as e:
        raise ValueError(f"Failed to read Takeout HTML: {e}") from e

    for row in parser.rows:
        event = _event_from_html_row(row, import_id=import_id)
        if event is not None:
            yield event


def _event_from_html_row(row: dict, *, import_id: str) -> WatchEvent | None:
    links = row.get("links", [])
    if not links:
        return None

    video_url = ""
    video_title = ""
    channel_url = ""
    channel_name = ""

    for href, text in links:
        if not href:
            continue
        if not video_url and extract_video_id(href):
            video_url = href
            video_title = text
        elif not channel_url and _CHANNEL_URL_RE.search(href):
            channel_url = href
            channel_name = text

    video_id = extract_video_id(video_url)
    if not is_valid_video_id(video_id):
        return None

    # Timestamp is free text at the end of the cell ("Apr 1, 2026, 8:42:00 AM PDT").
    text = row.get("text", "")
    ts_match = _HTML_TIMESTAMP_RE.search(text)
    watched_at = _normalize_html_timestamp(ts_match.group(1)) if ts_match else ""

    return WatchEvent(
        video_id=video_id,
        watched_at=watched_at,
        title=video_title,
        url=video_url,
        channel=channel_name,
        channel_url=channel_url,
        is_music=False,  # HTML export rarely distinguishes
        import_id=import_id,
        source_format="html",
    )


def _normalize_html_timestamp(raw: str) -> str:
    """Parse 'Apr 1, 2026, 8:42:00 AM' to RFC3339 UTC."""
    try:
        dt = datetime.strptime(raw.strip(), "%b %d, %Y, %I:%M:%S %p")
        return dt.replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return raw


def group_by_video(events: Iterable[WatchEvent]) -> dict[str, list[WatchEvent]]:
    """Group normalized events by video_id, preserving order."""
    grouped: dict[str, list[WatchEvent]] = {}
    for event in events:
        grouped.setdefault(event.video_id, []).append(event)
    return grouped

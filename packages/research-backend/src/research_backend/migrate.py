"""Backfill research vault sources from markdown files into Postgres.

Reads:
- sources/chats/raw/*.md — normalized AI conversation notes
- sources/youtube/raw/*.json or *.md — YouTube video metadata
- X bookmarks from configured path

Upserts into research_vault.sources using (kind, external_id) as the
idempotent key and content_hash for skip-on-match.
"""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass
class SourceRecord:
    kind: str
    external_id: str
    title: str
    body: str
    content_hash: str
    frontmatter: str | None = None
    url: str | None = None
    author: str | None = None
    source_ts: str | None = None


def compute_content_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def parse_frontmatter(text: str) -> tuple[dict | None, str]:
    """Split YAML frontmatter from markdown body. Returns (meta, body)."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", text, re.DOTALL)
    if match:
        try:
            meta = yaml.safe_load(match.group(1))
            return meta, match.group(2)
        except yaml.YAMLError:
            return None, text
    return None, text


def scan_chat_sources(chats_dir: Path) -> list[SourceRecord]:
    """Scan sources/chats/raw/*.md and produce SourceRecords."""
    records = []
    raw_dir = chats_dir / "raw"
    if not raw_dir.is_dir():
        return records

    for md_file in sorted(raw_dir.glob("*.md")):
        text = md_file.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)

        external_id = md_file.stem
        title = (meta or {}).get("title", md_file.stem)
        provider = (meta or {}).get("provider", "unknown")

        records.append(
            SourceRecord(
                kind="chat",
                external_id=external_id,
                title=title,
                body=body,
                content_hash=compute_content_hash(body),
                frontmatter=yaml.dump(meta) if meta else None,
                author=provider,
                source_ts=(meta or {}).get("created_at"),
            )
        )
    return records


def scan_youtube_sources(youtube_dir: Path) -> list[SourceRecord]:
    """Scan sources/youtube/raw/ and produce SourceRecords."""
    records = []
    raw_dir = youtube_dir / "raw"
    if not raw_dir.is_dir():
        return records

    for md_file in sorted(raw_dir.glob("*.md")):
        text = md_file.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)

        video_id = (meta or {}).get("video_id", md_file.stem)
        title = (meta or {}).get("title", md_file.stem)
        channel = (meta or {}).get("channel", "")
        url = (meta or {}).get("url", "")

        records.append(
            SourceRecord(
                kind="youtube",
                external_id=str(video_id),
                title=title,
                body=body,
                content_hash=compute_content_hash(body),
                frontmatter=yaml.dump(meta) if meta else None,
                url=url,
                author=channel,
                source_ts=(meta or {}).get("published_at"),
            )
        )
    return records


def scan_all_sources(research_vault_path: Path) -> list[SourceRecord]:
    """Scan all source directories and return combined records."""
    sources_dir = research_vault_path / "sources"
    records = []
    records.extend(scan_chat_sources(sources_dir / "chats"))
    records.extend(scan_youtube_sources(sources_dir / "youtube"))
    # X bookmarks: add when source path is confirmed (see open question #5 in taxonomy plan)
    return records

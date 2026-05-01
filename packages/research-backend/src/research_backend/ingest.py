"""Source ingestion into a knowledge base's raw/ directory."""

from __future__ import annotations

import datetime
import hashlib
import shutil
from pathlib import Path
from urllib.parse import urlparse

import httpx

from research_backend.extract import extract_text
from research_backend.models import Source


def ingest_file(file_path: Path, raw_dir: Path) -> Source:
    """Ingest a single file into raw/."""
    if not file_path.exists():
        raise FileNotFoundError(f"Source file not found: {file_path}")

    dest = raw_dir / file_path.name
    if dest.exists():
        existing_hash = _hash_file(dest)
        new_hash = _hash_file(file_path)
        if existing_hash == new_hash:
            text, mime = extract_text(dest)
            return Source(
                filename=dest.name,
                path=dest,
                content_hash=existing_hash,
                mime_type=mime,
                text=text,
            )

    shutil.copy2(file_path, dest)
    content_hash = _hash_file(dest)
    text, mime = extract_text(dest)

    return Source(
        filename=dest.name,
        path=dest,
        content_hash=content_hash,
        mime_type=mime,
        text=text,
    )


def ingest_url(url: str, raw_dir: Path) -> Source:
    """Download a URL and ingest into raw/."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Only http/https URLs supported, got: {parsed.scheme}")

    filename = _sanitize_filename(parsed.path.split("/")[-1] or "page.html")
    dest = raw_dir / filename

    resp = httpx.get(url, follow_redirects=True, timeout=60)
    resp.raise_for_status()
    dest.write_bytes(resp.content)

    content_hash = _hash_file(dest)
    text, mime = extract_text(dest)

    return Source(
        filename=filename,
        path=dest,
        content_hash=content_hash,
        mime_type=mime,
        text=text,
        metadata={"source_url": url},
    )


def ingest_directory(dir_path: Path, raw_dir: Path) -> list[Source]:
    """Ingest all supported files from a directory."""
    if not dir_path.is_dir():
        raise FileNotFoundError(f"Directory not found: {dir_path}")

    supported = {".pdf", ".md", ".markdown", ".txt", ".html", ".htm"}
    sources = []
    for f in sorted(dir_path.rglob("*")):
        if f.is_file() and f.suffix.lower() in supported:
            try:
                src = ingest_file(f, raw_dir)
                sources.append(src)
            except Exception as e:
                print(f"  Skipping {f.name}: {e}")
    return sources


def _hash_file(path: Path) -> str:
    """SHA-256 hash of file contents."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _sanitize_filename(name: str) -> str:
    """Sanitize a filename, removing path traversal and special chars."""
    name = name.replace("/", "_").replace("\\", "_").replace("..", "_")
    name = "".join(c for c in name if c.isalnum() or c in ".-_ ")
    return name[:200] or "unnamed"

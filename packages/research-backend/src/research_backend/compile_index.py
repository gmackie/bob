"""Index building, article parsing, and log management for wiki compilation."""

from __future__ import annotations

import datetime
from pathlib import Path

from research_backend.models import KBConfig

SUPPORTED_SOURCE_EXTENSIONS = {".pdf", ".md", ".markdown", ".txt", ".html", ".htm"}

ARTICLE_BREAK = "---ARTICLE_BREAK---"


def parse_articles(response: str) -> list[tuple[str, str]]:
    """Parse LLM response into (slug, content) pairs."""
    chunks = response.split(ARTICLE_BREAK)
    articles = []

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk or "---" not in chunk:
            continue

        # Extract title from frontmatter for slug
        title = extract_title(chunk)
        if not title:
            continue

        slug = slugify(title)
        articles.append((slug, chunk))

    return articles


def extract_title(content: str) -> str:
    """Extract title from YAML frontmatter."""
    for line in content.split("\n"):
        if line.startswith("title:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return ""


def extract_type(content: str) -> str:
    """Extract article type from YAML frontmatter."""
    for line in content.split("\n"):
        if line.startswith("type:"):
            return line.split(":", 1)[1].strip()
    return "concept"


def type_to_dir(article_type: str) -> str:
    """Map article type to wiki subdirectory."""
    mapping = {
        "concept": "concepts",
        "protocol": "protocols",
        "entity": "entities",
        "comparison": "concepts",
    }
    return mapping.get(article_type, "concepts")


def slugify(title: str) -> str:
    """Convert title to a filesystem-safe slug."""
    slug = title.lower()
    slug = slug.replace(" ", "-")
    slug = "".join(c for c in slug if c.isalnum() or c == "-")
    slug = slug.strip("-")
    return slug[:80] or "untitled"


def count_sources(raw_dir: Path) -> int:
    """Count source files in raw/."""
    if not raw_dir.exists():
        return 0
    return sum(
        1 for f in raw_dir.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_SOURCE_EXTENSIONS
    )


def rebuild_index(
    wiki_dir: Path, config: KBConfig, timestamp: str, *, source_count: int | None = None
) -> None:
    """Rebuild _index.md from all wiki articles."""
    articles_by_type: dict[str, list[tuple[str, str, str]]] = {}

    for subdir in ["concepts", "protocols", "entities"]:
        d = wiki_dir / subdir
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            title = extract_title(f.read_text())
            if not title:
                title = f.stem.replace("-", " ").title()
            slug = f.stem
            section = subdir.rstrip("s").capitalize() + "s"
            articles_by_type.setdefault(section, []).append((slug, title, subdir))

    total = sum(len(v) for v in articles_by_type.values())
    if source_count is None:
        source_count = count_sources(wiki_dir.parent / "raw")

    lines = [
        f"# {config.name.title()} Knowledge Base Index",
        "",
        f"Last updated: {timestamp}",
        f"Articles: {total} | Sources: {source_count}",
        "",
    ]

    for section, items in sorted(articles_by_type.items()):
        lines.append(f"## {section}")
        for slug, title, subdir in items:
            lines.append(f"- [[{subdir}/{slug}|{title}]]")
        lines.append("")

    (wiki_dir / "_index.md").write_text("\n".join(lines), encoding="utf-8")


def append_log(wiki_dir: Path, operation: str, message: str) -> None:
    """Append an entry to _log.md."""
    log_path = wiki_dir / "_log.md"
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if not log_path.exists():
        log_path.write_text("# Operation Log\n\n")

    with open(log_path, "a") as f:
        f.write(f"## [{timestamp}] {operation} | {message}\n\n")

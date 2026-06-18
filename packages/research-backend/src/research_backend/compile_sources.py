"""Source loading, filtering, truncation, and batching for wiki compilation."""

from __future__ import annotations

from pathlib import Path


def read_source_chunks(raw_dir: Path) -> list[str]:
    """Read all source files and return each as a separate string."""
    parts = []
    supported = {".pdf", ".md", ".markdown", ".txt", ".html", ".htm"}

    if not raw_dir.exists():
        return parts

    for f in sorted(raw_dir.iterdir()):
        if f.is_file() and f.suffix.lower() in supported:
            try:
                from research_backend.extract import extract_text
                text, _ = extract_text(f)
                text = smart_truncate(text)
                parts.append(f"### SOURCE: {f.name}\n\n{text}")
            except Exception as e:
                parts.append(f"### SOURCE: {f.name}\n\n[Error reading: {e}]")

    return parts


def read_external_source_chunks(
    ext_dir: Path, filter_rules: dict[str, str]
) -> list[str]:
    """Read source notes from an external pool (e.g. sources/youtube/raw/).

    Applies frontmatter-based filter rules. Each rule is a substring match
    against the corresponding frontmatter value. A rule with no matching
    key is treated as non-matching (so missing channels don't slip through
    a ``channel: huberman`` filter).
    """
    parts: list[str] = []
    for f in sorted(ext_dir.glob("*.md")):
        try:
            text = f.read_text(encoding="utf-8")
        except OSError:
            continue

        frontmatter = parse_frontmatter(text)
        if filter_rules and not matches_filter(frontmatter, filter_rules):
            continue

        source_type = frontmatter.get("source_type", "unknown")
        header = f"### SOURCE: {f.name} [source_type={source_type}]"

        body = smart_truncate_external(text, frontmatter)
        parts.append(f"{header}\n\n{body}")
    return parts


def source_chunk_id(chunk: str) -> str:
    """Return a stable source identity from a formatted source chunk header."""
    first_line = chunk.splitlines()[0] if chunk else ""
    if first_line.startswith("### SOURCE: "):
        return first_line
    return chunk


def parse_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter from a markdown file. Returns {} if none."""
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}
    try:
        import yaml
        data = yaml.safe_load(text[4:end])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def matches_filter(frontmatter: dict, rules: dict) -> bool:
    """Substring-match every rule against the corresponding frontmatter value."""
    for key, expected in rules.items():
        value = frontmatter.get(key)
        if value is None:
            return False
        if not isinstance(value, str):
            value = str(value)
        if not isinstance(expected, str):
            expected = str(expected)
        if expected.lower() not in value.lower():
            return False
    return True


def smart_truncate(text: str) -> str:
    """Generic truncation (legacy behavior: first 10K chars)."""
    if len(text) > 10000:
        return text[:10000] + "\n\n[... truncated, source continues ...]"
    return text


def smart_truncate_external(text: str, frontmatter: dict) -> str:
    """For external source notes, prefer keeping the transcript section intact.

    YouTube notes can have large transcript blocks inside the enrichment
    markers. For metadata-only notes, the whole thing is tiny and fits. For
    enriched notes, we truncate the transcript tail rather than the head, so
    the frontmatter + metadata summary always survives.
    """
    if len(text) <= 12000:
        return text

    # For YouTube enriched notes, keep frontmatter + first chunk of transcript.
    transcript_marker = "## Transcript"
    idx = text.find(transcript_marker)
    if idx != -1:
        head = text[:idx + len(transcript_marker)]
        transcript_body = text[idx + len(transcript_marker):]
        budget = max(0, 12000 - len(head) - 200)
        truncated_transcript = transcript_body[:budget]
        return head + truncated_transcript + "\n\n[... transcript truncated ...]"

    return text[:12000] + "\n\n[... source truncated ...]"


def batch_sources(chunks: list[str], char_limit: int) -> list[list[str]]:
    """Group source chunks into batches that fit within char_limit."""
    batches: list[list[str]] = []
    current: list[str] = []
    current_size = 0

    for chunk in chunks:
        chunk_size = len(chunk)
        if current and current_size + chunk_size > char_limit:
            batches.append(current)
            current = []
            current_size = 0
        current.append(chunk)
        current_size += chunk_size

    if current:
        batches.append(current)

    return batches

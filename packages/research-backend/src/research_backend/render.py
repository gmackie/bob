"""Output formatters for query results."""

from __future__ import annotations

import datetime
from pathlib import Path

from research_backend.models import QueryResult


def render_result(result: QueryResult, output_dir: Path | None = None) -> str:
    """Render a query result in the specified format. Returns the rendered content."""
    if result.format == "terminal":
        return _render_terminal(result)
    elif result.format == "marp":
        content = _render_marp(result)
    elif result.format == "md":
        content = _render_markdown(result)
    else:
        content = _render_markdown(result)

    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        slug = _slugify(result.question)
        filename = f"{timestamp}-{slug}.{_ext(result.format)}"
        dest = output_dir / filename
        dest.write_text(content, encoding="utf-8")
        print(f"  Output written to {dest}")

    return content


def _render_markdown(result: QueryResult) -> str:
    """Render as a standard markdown document."""
    sources = ", ".join(result.sources_consulted) if result.sources_consulted else "none"
    return (
        f"# {result.question}\n\n"
        f"*Query answered at {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*\n"
        f"*Sources consulted: {sources}*\n\n"
        f"---\n\n"
        f"{result.answer}\n"
    )


def _render_marp(result: QueryResult) -> str:
    """Render as a Marp slide deck."""
    lines = [
        "---",
        "marp: true",
        "theme: default",
        "paginate: true",
        "---",
        "",
        f"# {result.question}",
        "",
        f"*{datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')}*",
        "",
        "---",
        "",
    ]

    # Split answer into slides at ## headers or every ~300 words
    paragraphs = result.answer.split("\n\n")
    current_slide = []
    word_count = 0

    for para in paragraphs:
        if para.startswith("## ") or word_count > 250:
            if current_slide:
                lines.extend(current_slide)
                lines.extend(["", "---", ""])
                current_slide = []
                word_count = 0

        current_slide.append(para)
        current_slide.append("")
        word_count += len(para.split())

    if current_slide:
        lines.extend(current_slide)

    # Sources slide
    lines.extend(["", "---", "", "## Sources", ""])
    for src in result.sources_consulted:
        lines.append(f"- {src}")

    return "\n".join(lines)


def _render_terminal(result: QueryResult) -> str:
    """Render for terminal output (plain text)."""
    return f"Q: {result.question}\n\n{result.answer}"


def _slugify(text: str) -> str:
    slug = text.lower()[:50]
    slug = "".join(c if c.isalnum() or c == " " else "" for c in slug)
    return slug.strip().replace(" ", "-")


def _ext(fmt: str) -> str:
    return {"marp": "md", "md": "md", "matplotlib": "png"}.get(fmt, "md")

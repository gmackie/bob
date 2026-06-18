"""Wiki compilation: transform raw sources into wiki articles with provenance."""

from __future__ import annotations

import datetime
import json
import time
from pathlib import Path
from typing import Callable

from research_backend.compile_index import (
    append_log,
    extract_type,
    parse_articles,
    rebuild_index,
    type_to_dir,
)
from research_backend.compile_sources import (
    batch_sources,
    read_external_source_chunks,
    read_source_chunks,
    source_chunk_id,
)
from research_backend.llm import LLMProvider
from research_backend.models import KBConfig

SYSTEM_PROMPT = """You are a knowledge base compiler. Your job is to read raw source documents
and produce well-structured wiki articles in Obsidian-compatible markdown format.

CRITICAL RULES:
1. Every factual claim MUST include a [source: filename] citation referencing the raw source.
2. Use [[wikilinks]] to link to other articles in the knowledge base.
3. Include YAML frontmatter with title, type, category, sources, and last_compiled.
4. Organize content using the section structure provided for the article type.
5. Be concise but thorough. Prefer clarity over length.
6. Do not invent facts. If a source doesn't cover something, say so.

SOURCE TYPE AWARENESS:
- Sources tagged `source_type: youtube_video` are YouTube videos. They may contain:
  - Metadata only (title, channel, watch history) — use as routing/signal, not as evidence.
  - Transcript text (when `transcript_status: fetched`) — quote and cite like any other source.
- For metadata-only YouTube sources, acknowledge that the user watched this but do not
  fabricate content from the title alone. Say "User watched [title] on [channel]" at most.
- For transcript-enriched YouTube sources, cite with [source: <video-id>.md] and prefer
  the transcript content as the factual body.
- Sources tagged `source_type: chat_conversation` are exported LLM conversations.
  - User messages are evidence of intent, open questions, and topic clustering.
  - Assistant messages are provisional synthesis, not primary evidence.
  - Cite chat-derived material with [source: <canonical-id>.md].
  - Do not silently upgrade assistant claims into facts unless corroborated by stronger sources."""

COMPILE_PROMPT = """You are compiling articles for the "{kb_name}" knowledge base.
Description: {kb_description}

EXISTING ARTICLES (from _index.md):
{index_content}

RAW SOURCES TO PROCESS:
{sources_content}

ARTICLE TYPES AND THEIR REQUIRED SECTIONS:
{article_types}

CATEGORIES: {categories}

TASK: Analyze the raw sources above and produce wiki articles. For each article:

1. Choose the appropriate article_type (concept, protocol, entity, or comparison)
2. Choose the most fitting category
3. Write the article with YAML frontmatter and proper sections
4. EVERY factual claim must have [source: filename] citation
5. Use [[wikilinks]] to reference other articles (existing or new)

Output each article in this exact format, separated by "---ARTICLE_BREAK---":

---
title: Article Title
type: concept
category: fasting
sources: [source1.md, source2.pdf]
last_compiled: {timestamp}
---

# Article Title

Content with [source: source1.md] citations...

## Section Name

More content with [source: source2.pdf] citations...

---ARTICLE_BREAK---

Produce as many articles as the source material warrants. Prefer focused articles
over one giant article. Link between articles with [[wikilinks]]."""


BATCH_CHAR_LIMIT = 30_000  # ~7.5K tokens per batch, safe for any provider


def compile_kb(
    kb_root: Path,
    config: KBConfig,
    provider: LLMProvider,
    *,
    full: bool = False,
    article_slug: str | None = None,
    progress: Callable[[str], None] | None = None,
) -> list[Path]:
    """Compile raw sources into wiki articles.

    Sources are processed in batches to stay within LLM context limits.
    Returns list of paths to written articles.

    In addition to kb_root/raw/, any pool listed in ``config.external_sources``
    is folded in. External sources are filtered by frontmatter match rules
    so a single pool (e.g. sources/youtube/raw/) can serve multiple KBs.
    """
    _progress = progress or (lambda message: print(message, flush=True))
    raw_dir = kb_root / "raw"
    wiki_dir = kb_root / "wiki"
    wiki_dir.mkdir(parents=True, exist_ok=True)
    seen_external_sources: set[str] = set()

    # Read raw source chunks from the KB's own raw/
    _progress(f"  Loading local sources from {raw_dir}...")
    source_chunks = read_source_chunks(raw_dir)
    _progress(f"  Loaded {len(source_chunks)} local raw sources.")

    # Fold in any external source pools (YouTube, future adapters)
    repo_root = kb_root.parent.parent if (kb_root.parent.name == "kbs") else kb_root.parent
    for ext in config.external_sources:
        ext_path = ext.get("path") if isinstance(ext, dict) else None
        if not ext_path:
            continue
        ext_dir = (repo_root / ext_path).resolve()
        if not ext_dir.exists():
            _progress(f"  [warn] external_sources path not found: {ext_dir}")
            continue
        filter_rules = ext.get("filter", {}) if isinstance(ext, dict) else {}
        _progress(
            f"  Loading external sources from {ext_path}"
            + (f" with filter {json.dumps(filter_rules, sort_keys=True)}" if filter_rules else "")
            + "..."
        )
        ext_chunks = read_external_source_chunks(ext_dir, filter_rules)
        unique_ext_chunks: list[str] = []
        for chunk in ext_chunks:
            sid = source_chunk_id(chunk)
            if sid in seen_external_sources:
                continue
            seen_external_sources.add(sid)
            unique_ext_chunks.append(chunk)
        if unique_ext_chunks:
            _progress(
                f"  Added {len(unique_ext_chunks)} external sources from {ext_path}"
            )
            source_chunks.extend(unique_ext_chunks)

    if not source_chunks:
        _progress("No raw sources found. Ingest some sources first.")
        return []

    # Skip sources already processed in a prior run (resume support)
    compiled_log = wiki_dir / ".compiled_sources"
    already_compiled: set[str] = set()
    if compiled_log.exists():
        already_compiled = {
            line.strip() for line in compiled_log.read_text().splitlines() if line.strip()
        }
        before = len(source_chunks)
        source_chunks = [
            c for c in source_chunks if source_chunk_id(c) not in already_compiled
        ]
        skipped = before - len(source_chunks)
        if skipped:
            _progress(f"  Skipping {skipped} sources already compiled (resume).")

    if not source_chunks:
        _progress("All sources already compiled. Nothing to do.")
        return []

    total_source_count = len(source_chunks)

    # Group sources into batches
    batches = batch_sources(source_chunks, BATCH_CHAR_LIMIT)
    _progress(
        f"  Processing {len(source_chunks)} sources in {len(batches)} batch(es)..."
    )

    # Format article types
    article_types_str = ""
    for atype, adef in config.article_types.items():
        sections = ", ".join(adef.get("sections", []))
        article_types_str += f"  {atype}: [{sections}]\n"

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    written = []

    for i, batch in enumerate(batches, 1):
        # Read existing index (refreshed each batch so new articles are visible)
        index_path = wiki_dir / "_index.md"
        index_content = (
            index_path.read_text() if index_path.exists()
            else "(empty - no articles yet)"
        )

        sources_content = "\n\n---\n\n".join(batch)
        _progress(
            f"  Batch {i}/{len(batches)} ({len(batch)} sources, {len(sources_content):,} chars)..."
        )

        prompt = COMPILE_PROMPT.format(
            kb_name=config.name,
            kb_description=config.description,
            index_content=index_content,
            sources_content=sources_content,
            article_types=article_types_str,
            categories=", ".join(config.categories),
            timestamp=timestamp,
        )

        # Call LLM with retry on transient errors
        response = _call_with_retry(provider, prompt, SYSTEM_PROMPT, _progress)

        # Parse response into articles
        articles = parse_articles(response)

        for slug, content in articles:
            article_type = extract_type(content)
            subdir = type_to_dir(article_type)
            dest_dir = wiki_dir / subdir
            dest_dir.mkdir(parents=True, exist_ok=True)

            dest = dest_dir / f"{slug}.md"
            dest.write_text(content, encoding="utf-8")
            written.append(dest)
            _progress(f"    Wrote {subdir}/{slug}.md")

        # Mark this batch's sources as compiled for resume support
        with compiled_log.open("a", encoding="utf-8") as f:
            for chunk in batch:
                f.write(source_chunk_id(chunk) + "\n")

    # Rebuild index once after all batches complete
    rebuild_index(wiki_dir, config, timestamp, source_count=total_source_count)

    # Final log
    append_log(
        wiki_dir,
        "compile",
        f"Compiled {len(written)} articles from {total_source_count} sources",
    )

    return written


def _call_with_retry(
    provider: LLMProvider,
    prompt: str,
    system: str,
    progress: Callable[[str], None],
    max_retries: int = 3,
) -> str:
    """Call provider.generate with exponential backoff on transient errors."""
    for attempt in range(max_retries):
        try:
            return provider.generate(prompt, system=system)
        except Exception as e:
            err_name = type(e).__name__
            if attempt == max_retries - 1:
                raise
            wait = 2 ** (attempt + 1)
            progress(
                f"    [retry] {err_name}: {e}"
                f" — waiting {wait}s (attempt {attempt + 1}/{max_retries})"
            )
            time.sleep(wait)
    raise RuntimeError("unreachable")

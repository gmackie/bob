"""Q&A engine over compiled wiki content."""

from __future__ import annotations

import datetime
from pathlib import Path

from research_backend.llm import LLMProvider
from research_backend.models import KBConfig, QueryResult

SYSTEM_PROMPT = """You are a research assistant answering questions from a personal knowledge base.
Your answers must be grounded in the wiki articles provided.

RULES:
1. Only state facts that appear in the provided articles.
2. Cite evidence using the provenance notation defined below.
3. If the articles don't contain enough information, say so clearly.
4. Be concise and direct.
5. If the question asks for comparison, structure your answer as a comparison.

PROVENANCE RULES:
When citing a source, prefix the citation with its kind so the user knows
what the evidence is:
- [wiki:slug] — a compiled wiki article (highest confidence).
- [transcript:video-id] — transcript text from a YouTube video.
- [video-metadata:video-id] — video title/channel/watch history only.
- [watch-signal:query] — attention-data observation (e.g. "user rewatched X 3 times").
- [chat:provider/canonical-id] — normalized exported conversation; useful for prior reasoning and synthesis, lower confidence than primary sources.
If evidence is metadata-only, do not fabricate content. Say what is known
(that the user watched it, when, how often) and nothing more.
Treat assistant chat output as provisional unless corroborated by stronger sources."""

QUERY_PROMPT = """KNOWLEDGE BASE: {kb_name}
QUESTION: {question}

INDEX (article summaries):
{index_content}

Based on the index above, I've loaded these relevant articles:
{articles_content}

Answer the question using ONLY information from these articles.
Cite sources with the provenance notation from the system prompt
([wiki:slug], [transcript:video-id], [video-metadata:video-id], [watch-signal:query], [chat:provider/canonical-id]).
If you can't answer from the available articles, explain what's missing."""


def query_kb(
    kb_root: Path,
    config: KBConfig,
    provider: LLMProvider,
    question: str,
    *,
    output_format: str = "md",
) -> QueryResult:
    """Query a knowledge base and return a formatted answer."""
    wiki_dir = kb_root / "wiki"
    index_path = wiki_dir / "_index.md"

    if not index_path.exists():
        return QueryResult(
            question=question,
            answer="No compiled wiki found. Run `research compile` first.",
            sources_consulted=[],
            format=output_format,
        )

    index_content = index_path.read_text()

    # Load all articles (at this scale, we can read them all)
    articles_content, slugs = _load_articles(wiki_dir)

    prompt = QUERY_PROMPT.format(
        kb_name=config.name,
        question=question,
        index_content=index_content,
        articles_content=articles_content,
    )

    answer = provider.generate(prompt, system=SYSTEM_PROMPT)

    result = QueryResult(
        question=question,
        answer=answer,
        sources_consulted=slugs,
        format=output_format,
    )

    # Log the query
    _append_log(wiki_dir, "query", question)

    return result


MAX_QUERY_CONTEXT_CHARS = 80_000  # ~20K tokens, leaves headroom for answer


def _load_articles(wiki_dir: Path) -> tuple[str, list[str]]:
    """Load wiki articles, capped at MAX_QUERY_CONTEXT_CHARS.

    For small KBs this loads everything. For larger KBs, it loads shortest
    articles first (cheap context, broader coverage) until the cap is hit.
    Selective loading by embeddings is a Phase 3+ optimization; this is the
    pragmatic baseline.
    """
    parts: list[str] = []
    slugs: list[str] = []
    total = 0

    candidates: list[tuple[int, str, str]] = []  # (size, slug, text)
    for subdir in ["concepts", "protocols", "entities"]:
        d = wiki_dir / subdir
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            try:
                text = f.read_text()
            except OSError:
                continue
            candidates.append((len(text), f"{subdir}/{f.stem}", text))

    candidates.sort(key=lambda row: row[0])
    for size, slug, text in candidates:
        if total + size > MAX_QUERY_CONTEXT_CHARS and parts:
            break
        parts.append(f"### ARTICLE: {slug}\n\n{text}")
        slugs.append(slug)
        total += size

    return "\n\n---\n\n".join(parts), slugs


def _append_log(wiki_dir: Path, operation: str, message: str) -> None:
    """Append an entry to _log.md."""
    log_path = wiki_dir / "_log.md"
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if not log_path.exists():
        log_path.write_text("# Operation Log\n\n")

    with open(log_path, "a") as f:
        f.write(f"## [{timestamp}] {operation} | {message}\n\n")

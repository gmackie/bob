"""Knowledge base API routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/kb", tags=["knowledge-bases"])


def _get_kbs_dir(request: Request) -> Path:
    """Resolve KBS_DIR from app settings."""
    return Path(request.app.state.settings.kbs_dir)


class KBSummary(BaseModel):
    name: str
    description: str
    source_count: int
    article_count: int
    categories: list[str]


class ArticleSummary(BaseModel):
    slug: str
    title: str
    article_type: str
    path: str


class ArticleDetail(BaseModel):
    slug: str
    title: str
    content: str
    article_type: str
    sources: list[str]


class SourceInfo(BaseModel):
    filename: str
    size_bytes: int
    mime_type: str


class QueryRequest(BaseModel):
    question: str
    format: str = "md"


class QueryResponse(BaseModel):
    question: str
    answer: str
    sources_consulted: list[str]


class CompileResponse(BaseModel):
    articles_written: int
    message: str


@router.get("")
def list_knowledge_bases(request: Request) -> list[KBSummary]:
    """List all available knowledge bases."""
    kbs_dir = _get_kbs_dir(request)
    if not kbs_dir.exists():
        return []

    results = []
    for kb_dir in sorted(kbs_dir.iterdir()):
        if not kb_dir.is_dir() or not (kb_dir / "kb.yaml").exists():
            continue

        from research_backend.models import KBConfig
        config = KBConfig.load(kb_dir / "kb.yaml")

        raw_count = sum(1 for f in (kb_dir / "raw").iterdir() if f.is_file()) if (kb_dir / "raw").exists() else 0
        article_count = _count_articles(kb_dir / "wiki")

        results.append(KBSummary(
            name=config.name,
            description=config.description,
            source_count=raw_count,
            article_count=article_count,
            categories=config.categories,
        ))

    return results


@router.get("/{name}")
def get_knowledge_base(request: Request, name: str) -> KBSummary:
    """Get metadata for a specific knowledge base."""
    kbs_dir = _get_kbs_dir(request)
    kb_root = _resolve_kb(kbs_dir, name)
    from research_backend.models import KBConfig
    config = KBConfig.load(kb_root / "kb.yaml")

    raw_count = sum(1 for f in (kb_root / "raw").iterdir() if f.is_file()) if (kb_root / "raw").exists() else 0

    return KBSummary(
        name=config.name,
        description=config.description,
        source_count=raw_count,
        article_count=_count_articles(kb_root / "wiki"),
        categories=config.categories,
    )


@router.get("/{name}/wiki")
def list_articles(request: Request, name: str) -> list[ArticleSummary]:
    """List all wiki articles for a knowledge base."""
    kbs_dir = _get_kbs_dir(request)
    kb_root = _resolve_kb(kbs_dir, name)
    wiki_dir = kb_root / "wiki"
    articles = []

    for subdir in ["concepts", "protocols", "entities"]:
        d = wiki_dir / subdir
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            content = f.read_text()
            title = _extract_frontmatter(content, "title") or f.stem.replace("-", " ").title()
            atype = _extract_frontmatter(content, "type") or subdir.rstrip("s")
            articles.append(ArticleSummary(
                slug=f"{subdir}/{f.stem}",
                title=title,
                article_type=atype,
                path=f"{subdir}/{f.name}",
            ))

    return articles


@router.get("/{name}/wiki/{subdir}/{slug}")
def get_article(request: Request, name: str, subdir: str, slug: str) -> ArticleDetail:
    """Read a specific wiki article."""
    kbs_dir = _get_kbs_dir(request)
    kb_root = _resolve_kb(kbs_dir, name)
    article_path = kb_root / "wiki" / subdir / f"{slug}.md"

    if not article_path.exists():
        raise HTTPException(404, f"Article not found: {subdir}/{slug}")

    content = article_path.read_text()
    title = _extract_frontmatter(content, "title") or slug.replace("-", " ").title()
    atype = _extract_frontmatter(content, "type") or "concept"
    sources_str = _extract_frontmatter(content, "sources") or ""
    sources = [s.strip() for s in sources_str.strip("[]").split(",") if s.strip()]

    return ArticleDetail(
        slug=f"{subdir}/{slug}",
        title=title,
        content=content,
        article_type=atype,
        sources=sources,
    )


@router.get("/{name}/sources")
def list_sources(request: Request, name: str) -> list[SourceInfo]:
    """List raw sources for a knowledge base."""
    kbs_dir = _get_kbs_dir(request)
    kb_root = _resolve_kb(kbs_dir, name)
    raw_dir = kb_root / "raw"
    if not raw_dir.exists():
        return []

    sources = []
    for f in sorted(raw_dir.iterdir()):
        if f.is_file():
            suffix = f.suffix.lower()
            mime = {
                ".pdf": "application/pdf",
                ".md": "text/markdown",
                ".txt": "text/plain",
                ".html": "text/html",
            }.get(suffix, "application/octet-stream")

            sources.append(SourceInfo(
                filename=f.name,
                size_bytes=f.stat().st_size,
                mime_type=mime,
            ))

    return sources


@router.post("/{name}/query")
def query_kb_endpoint(request: Request, name: str, req: QueryRequest) -> QueryResponse:
    """Query a knowledge base."""
    kbs_dir = _get_kbs_dir(request)
    kb_root = _resolve_kb(kbs_dir, name)
    from research_backend.llm import get_provider
    from research_backend.models import KBConfig
    from research_backend.query import query_kb

    config = KBConfig.load(kb_root / "kb.yaml")
    provider = get_provider(config.provider)
    result = query_kb(kb_root, config, provider, req.question, output_format=req.format)

    return QueryResponse(
        question=result.question,
        answer=result.answer,
        sources_consulted=result.sources_consulted,
    )


@router.post("/{name}/compile")
def compile_kb_endpoint(request: Request, name: str) -> CompileResponse:
    """Trigger compilation of a knowledge base."""
    kbs_dir = _get_kbs_dir(request)
    kb_root = _resolve_kb(kbs_dir, name)
    from research_backend.compile import compile_kb
    from research_backend.llm import get_provider
    from research_backend.models import KBConfig

    config = KBConfig.load(kb_root / "kb.yaml")
    provider = get_provider(config.provider)
    written = compile_kb(kb_root, config, provider)

    return CompileResponse(
        articles_written=len(written),
        message=f"Compiled {len(written)} articles",
    )


def _resolve_kb(kbs_dir: Path, name: str) -> Path:
    kb_root = kbs_dir / name
    if not kb_root.exists() or not (kb_root / "kb.yaml").exists():
        raise HTTPException(404, f"Knowledge base '{name}' not found")
    return kb_root


def _count_articles(wiki_dir: Path) -> int:
    count = 0
    if not wiki_dir.exists():
        return 0
    for subdir in ["concepts", "protocols", "entities"]:
        d = wiki_dir / subdir
        if d.exists():
            count += sum(1 for f in d.glob("*.md"))
    return count


def _extract_frontmatter(content: str, field: str) -> str | None:
    """Extract a field from YAML frontmatter."""
    if not content.startswith("---"):
        return None
    fm = content.split("---")[1]
    for line in fm.split("\n"):
        if line.startswith(f"{field}:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return None

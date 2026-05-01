"""Chat source API routes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _get_sources_root(request: Request) -> Path:
    """Resolve sources/chats dir from app settings."""
    return Path(request.app.state.settings.sources_dir) / "chats"


class ProviderCount(BaseModel):
    provider: str
    count: int


class ChatStatus(BaseModel):
    total_conversations: int
    total_messages: int
    first_updated: str | None = None
    last_updated: str | None = None
    providers: list[ProviderCount]
    imports: list[dict[str, Any]]


class ChatConversationSummary(BaseModel):
    canonical_id: str
    provider: str
    title: str
    message_count: int
    created_at: str = ""
    updated_at: str = ""


class ChatConversationDetail(ChatConversationSummary):
    assistant_models: list[str]
    body: str


class ChatImportResult(BaseModel):
    import_id: str
    conversations_parsed: int
    conversations_created: int
    conversations_updated: int
    errors: list[str]
    skipped_reason: str = ""


@router.get("/status", response_model=ChatStatus)
def chats_status(request: Request) -> ChatStatus:
    """Summary of imported chat content and import history."""
    from research_backend.chats.manifest import iter_events, manifest_path
    from research_backend.chats.stats import compute_stats

    sources_root = _get_sources_root(request)
    stats = compute_stats(sources_root)
    imports: list[dict[str, Any]] = []
    if sources_root.exists():
        manifest = manifest_path(sources_root)
        by_id: dict[str, dict[str, Any]] = {}
        for event in iter_events(manifest):
            kind = event.get("kind")
            if kind == "import_started":
                import_id = str(event.get("import_id") or "")
                by_id[import_id] = {
                    "import_id": import_id,
                    "source": event.get("source", ""),
                    "started_at": event.get("started_at", ""),
                    "finished_at": None,
                    "conversations": 0,
                }
            elif kind == "import_finished":
                import_id = str(event.get("import_id") or "")
                if import_id in by_id:
                    by_id[import_id]["finished_at"] = event.get("finished_at")
                    by_id[import_id]["conversations"] = event.get(
                        "conversations", 0
                    )
        imports = list(by_id.values())
        imports.sort(key=lambda row: row.get("started_at", ""), reverse=True)

    return ChatStatus(
        total_conversations=stats.total_conversations,
        total_messages=stats.total_messages,
        first_updated=stats.first_updated or None,
        last_updated=stats.last_updated or None,
        providers=[
            ProviderCount(provider=provider, count=count)
            for provider, count in stats.providers
        ],
        imports=imports,
    )


@router.get("/conversations", response_model=list[ChatConversationSummary])
def list_conversations(
    request: Request,
    provider: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[ChatConversationSummary]:
    """Paginated list of normalized chat conversations."""
    from research_backend.chats.stats import read_frontmatter

    sources_root = _get_sources_root(request)
    raw_dir = sources_root / "raw"
    if not raw_dir.exists():
        return []

    conversations: list[ChatConversationSummary] = []
    for note_path in sorted(raw_dir.glob("*.md")):
        frontmatter = read_frontmatter(note_path)
        if frontmatter.get("source_type") != "chat_conversation":
            continue
        current_provider = str(frontmatter.get("provider") or "")
        if provider and provider.lower() not in current_provider.lower():
            continue
        conversations.append(_summary_from_frontmatter(frontmatter))

    conversations.sort(key=lambda row: row.updated_at or row.created_at, reverse=True)
    return conversations[offset : offset + limit]


@router.get("/conversations/{canonical_id}", response_model=ChatConversationDetail)
def get_conversation(request: Request, canonical_id: str) -> ChatConversationDetail:
    """Read a specific normalized chat source note."""
    from research_backend.chats.notes import conversation_note_path
    from research_backend.chats.stats import read_frontmatter

    sources_root = _get_sources_root(request)
    note_path = conversation_note_path(sources_root / "raw", canonical_id)
    if not note_path.exists():
        raise HTTPException(404, f"Conversation {canonical_id} not imported")

    frontmatter = read_frontmatter(note_path)
    text = note_path.read_text(encoding="utf-8")
    body = text.split("---\n", 2)[-1] if text.count("---\n") >= 2 else text
    summary = _summary_from_frontmatter(frontmatter)
    return ChatConversationDetail(
        **summary.model_dump(),
        assistant_models=list(frontmatter.get("assistant_models") or []),
        body=body,
    )


@router.post("/import", response_model=ChatImportResult)
async def import_chat_export_endpoint(
    request: Request,
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    no_copy: bool = Query(False),
) -> ChatImportResult:
    """Upload a chat export JSON file and import it."""
    import tempfile

    from research_backend.chats.importer import import_chat_export

    sources_root = _get_sources_root(request)
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix != ".json":
        raise HTTPException(400, f"Unsupported chat export format: {suffix}")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        report = import_chat_export(
            tmp_path,
            sources_root,
            dry_run=dry_run,
            copy_export=not no_copy,
        )
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass

    return ChatImportResult(
        import_id=report.import_id,
        conversations_parsed=report.conversations_parsed,
        conversations_created=report.conversations_created,
        conversations_updated=report.conversations_updated,
        errors=report.errors[:10],
        skipped_reason=report.skipped_reason,
    )


def _summary_from_frontmatter(frontmatter: dict) -> ChatConversationSummary:
    return ChatConversationSummary(
        canonical_id=str(frontmatter.get("canonical_id") or ""),
        provider=str(frontmatter.get("provider") or ""),
        title=str(frontmatter.get("title") or ""),
        message_count=int(frontmatter.get("message_count") or 0),
        created_at=str(frontmatter.get("created_at") or ""),
        updated_at=str(frontmatter.get("updated_at") or ""),
    )

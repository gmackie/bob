from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlmodel import Session

from research_backend.db import get_session
from research_backend.schemas.api import (
    CollectionCreate,
    CollectionItemCreate,
    DownloadRequest,
    LibraryExport,
    LibraryResponse,
    PaperDetailResponse,
    PaperInput,
    SearchResponseSchema,
    SettingsPayload,
)
from research_backend.services.analysis import AnalysisGateway
from research_backend.services.papers import PaperService

router = APIRouter(prefix="/api")


def get_paper_service(request: Request, session: Session = Depends(get_session)) -> PaperService:
    """Build a PaperService with a live DB session and settings-derived paths."""
    settings = request.app.state.settings
    data_dir = Path(settings.sources_dir) if settings.sources_dir else Path("/tmp/research-data")
    analysis_gateway = AnalysisGateway()
    return PaperService(session=session, data_dir=data_dir, analysis_gateway=analysis_gateway)


def _runtime_settings(request: Request, service: PaperService) -> dict[str, str]:
    settings = request.app.state.settings
    defaults = {
        "analysis_provider": settings.analysis_provider,
        "codex_app_server_command": settings.codex_app_server_command,
        "codex_model": settings.codex_model,
        "codex_turn_timeout_seconds": str(settings.codex_turn_timeout_seconds),
        "ollama_base_url": settings.ollama_base_url,
        "ollama_generation_model": settings.ollama_generation_model,
        "ollama_embedding_model": settings.ollama_embedding_model,
        "unpaywall_email": settings.unpaywall_email,
        "openalex_api_key": settings.openalex_api_key,
    }
    return service.get_settings(defaults=defaults)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/search", response_model=SearchResponseSchema)
def search(
    request: Request,
    q: str,
    sources: list[str] | None = None,
    page: int = 1,
):
    result = request.app.state.search_gateway.search(q, sources=sources, page=page)
    request.app.state.usage_sink("search", {"query": q, "page": page})
    return result.model_dump()


@router.post("/papers/import", response_model=PaperDetailResponse)
def import_paper(payload: PaperInput, service: PaperService = Depends(get_paper_service)):
    return service.import_paper(payload)


@router.get("/papers/{paper_id}", response_model=PaperDetailResponse)
def get_paper(paper_id: str, service: PaperService = Depends(get_paper_service)):
    return service.get_paper(paper_id)


@router.post("/papers/{paper_id}/resolve-access", response_model=PaperDetailResponse)
def resolve_access(
    request: Request,
    paper_id: str,
    service: PaperService = Depends(get_paper_service),
):
    return service.resolve_access(paper_id, request.app.state.access_resolver)


@router.post("/papers/{paper_id}/download")
def download(
    paper_id: str,
    payload: DownloadRequest,
    service: PaperService = Depends(get_paper_service),
):
    return service.download_asset(paper_id, url=payload.url, file_path=payload.file_path)


@router.post("/papers/{paper_id}/summarize")
def summarize(
    request: Request,
    paper_id: str,
    service: PaperService = Depends(get_paper_service),
):
    runtime = _runtime_settings(request, service)
    provider = runtime.get("analysis_provider", "codex_app_server")
    model_key = "codex_model" if provider == "codex_app_server" else "ollama_generation_model"
    return service.summarize_paper(
        paper_id,
        model=runtime[model_key],
        provider=provider,
        settings=runtime,
    )


@router.post("/papers/{paper_id}/extract-table")
def extract_table(
    request: Request,
    paper_id: str,
    service: PaperService = Depends(get_paper_service),
):
    runtime = _runtime_settings(request, service)
    provider = runtime.get("analysis_provider", "codex_app_server")
    model_key = "codex_model" if provider == "codex_app_server" else "ollama_generation_model"
    return service.extract_table(
        paper_id,
        model=runtime[model_key],
        provider=provider,
        settings=runtime,
    )


@router.get("/library", response_model=LibraryResponse)
def library(
    query: str | None = None,
    collection_id: str | None = None,
    service: PaperService = Depends(get_paper_service),
):
    return service.list_library(query=query, collection_id=collection_id)


@router.post("/collections")
def create_collection(payload: CollectionCreate, service: PaperService = Depends(get_paper_service)):
    return service.create_collection(payload)


@router.get("/collections")
def list_collections(service: PaperService = Depends(get_paper_service)):
    return service.list_collections()


@router.post("/collections/{collection_id}/items")
def add_collection_item(
    collection_id: str,
    payload: CollectionItemCreate,
    service: PaperService = Depends(get_paper_service),
):
    return service.add_paper_to_collection(collection_id, payload)


@router.get("/settings")
def get_settings(request: Request, service: PaperService = Depends(get_paper_service)):
    return _runtime_settings(request, service)


@router.post("/settings")
def update_settings(
    request: Request,
    payload: SettingsPayload,
    service: PaperService = Depends(get_paper_service),
):
    return service.update_settings(payload, defaults=_runtime_settings(request, service))


@router.get("/usage")
def get_usage(service: PaperService = Depends(get_paper_service)):
    return service.get_usage()


@router.get("/library/export/json", response_model=LibraryExport)
def export_library_json(service: PaperService = Depends(get_paper_service)):
    return service.export_library_json()


@router.get("/library/export/bibtex", response_class=PlainTextResponse)
def export_library_bibtex(service: PaperService = Depends(get_paper_service)):
    return service.export_library_bibtex()


@router.post("/library/import/json")
def import_library_json(payload: LibraryExport, service: PaperService = Depends(get_paper_service)):
    return service.import_library_json(payload)

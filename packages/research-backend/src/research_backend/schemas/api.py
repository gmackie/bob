from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SourceRef(BaseModel):
    provider: str
    external_id: str
    url: str
    score: float | None = None


class AccessCandidate(BaseModel):
    kind: str
    url: str
    license: str | None = None
    version: str | None = None
    source: str


class ProviderWarningSchema(BaseModel):
    provider: str
    message: str


class PaperInput(BaseModel):
    title: str
    authors: list[str] = Field(default_factory=list)
    abstract: str | None = None
    year: int | None = None
    doi: str | None = None
    venue: str | None = None
    fields: list[str] = Field(default_factory=list)
    source_refs: list[SourceRef] = Field(default_factory=list)
    access_candidates: list[AccessCandidate] = Field(default_factory=list)


class DocumentAsset(BaseModel):
    paper_id: str
    file_path: str
    mime_type: str
    checksum: str
    pages: int
    text_status: str


class AnalysisArtifactResponse(BaseModel):
    paper_id: str
    model: str
    summary_md: str | None = None
    extraction_json: dict[str, Any] | None = None
    created_at: datetime


class PaperDetailResponse(PaperInput):
    id: str
    document_asset: DocumentAsset | None = None
    latest_summary: AnalysisArtifactResponse | None = None


class SearchResponseSchema(BaseModel):
    results: list[PaperInput]
    warnings: list[ProviderWarningSchema]


class LibraryResponse(BaseModel):
    total: int
    results: list[PaperDetailResponse]


class DownloadRequest(BaseModel):
    url: str | None = None
    file_path: str | None = None


class CollectionCreate(BaseModel):
    name: str


class CollectionResponse(BaseModel):
    id: str
    name: str
    paper_count: int = 0


class CollectionItemCreate(BaseModel):
    paper_id: str


class LibraryExport(BaseModel):
    papers: list[PaperInput]
    collections: list[CollectionResponse]


class SettingsPayload(BaseModel):
    analysis_provider: str | None = None
    codex_app_server_command: str | None = None
    codex_model: str | None = None
    codex_turn_timeout_seconds: int | None = None
    ollama_base_url: str | None = None
    ollama_generation_model: str | None = None
    ollama_embedding_model: str | None = None
    unpaywall_email: str | None = None
    openalex_api_key: str | None = None

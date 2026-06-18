from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PaperTable(SQLModel, table=True):
    __tablename__ = "papers"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    title: str
    authors: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    abstract: str | None = None
    year: int | None = None
    doi: str | None = Field(default=None, index=True)
    venue: str | None = None
    fields: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class PaperSourceTable(SQLModel, table=True):
    __tablename__ = "paper_sources"
    __table_args__ = (UniqueConstraint("paper_id", "provider", "external_id"),)

    id: int | None = Field(default=None, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)
    provider: str
    external_id: str
    url: str
    score: float | None = None


class AccessCandidateTable(SQLModel, table=True):
    __tablename__ = "access_candidates"
    __table_args__ = (UniqueConstraint("paper_id", "kind", "url"),)

    id: int | None = Field(default=None, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)
    kind: str
    url: str
    license: str | None = None
    version: str | None = None
    source: str


class DocumentAssetTable(SQLModel, table=True):
    __tablename__ = "document_assets"

    id: int | None = Field(default=None, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True, unique=True)
    file_path: str
    mime_type: str
    checksum: str
    pages: int
    text_status: str = "ready"
    created_at: datetime = Field(default_factory=utc_now)


class AnalysisArtifactTable(SQLModel, table=True):
    __tablename__ = "analysis_artifacts"
    __table_args__ = (UniqueConstraint("paper_id", "kind", "model", "prompt_version"),)

    id: int | None = Field(default=None, primary_key=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)
    kind: str
    model: str
    prompt_version: str = "v1"
    summary_md: str | None = None
    extraction_json: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now)


class CollectionTable(SQLModel, table=True):
    __tablename__ = "collections"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=utc_now)


class CollectionItemTable(SQLModel, table=True):
    __tablename__ = "collection_items"
    __table_args__ = (UniqueConstraint("collection_id", "paper_id"),)

    id: int | None = Field(default=None, primary_key=True)
    collection_id: str = Field(foreign_key="collections.id", index=True)
    paper_id: str = Field(foreign_key="papers.id", index=True)
    created_at: datetime = Field(default_factory=utc_now)


class UsageEventTable(SQLModel, table=True):
    __tablename__ = "usage_events"

    id: int | None = Field(default=None, primary_key=True)
    kind: str = Field(index=True)
    payload: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utc_now)


class SettingTable(SQLModel, table=True):
    __tablename__ = "settings"

    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=utc_now)

import hashlib
import shutil
from pathlib import Path

import httpx
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, delete, func, or_, select

from research_backend.db_models import (
    AccessCandidateTable,
    AnalysisArtifactTable,
    CollectionItemTable,
    CollectionTable,
    DocumentAssetTable,
    PaperSourceTable,
    PaperTable,
    SettingTable,
    UsageEventTable,
)
from research_backend.schemas.api import (
    AccessCandidate,
    CollectionCreate,
    CollectionItemCreate,
    DocumentAsset,
    LibraryExport,
    PaperDetailResponse,
    PaperInput,
    SettingsPayload,
)
from research_backend.services.analysis import AnalysisGateway, extract_pdf_text


def fingerprint(title: str, year: int | None) -> str:
    return f"{title.strip().lower()}::{year or 'unknown'}"


class AccessResolver:
    def __init__(self, *, unpaywall=None, acm=None, ieee=None) -> None:
        self.unpaywall = unpaywall
        self.acm = acm
        self.ieee = ieee

    def annotate_result(self, result):
        if self.unpaywall and result.doi:
            candidates = [item.model_dump() if hasattr(item, "model_dump") else item for item in result.access_candidates]
            for candidate in self.unpaywall.resolve(result.doi):
                if candidate not in candidates:
                    candidates.append(candidate)
            result = result.model_copy(update={"access_candidates": candidates})
        if self.acm:
            result = self.acm.annotate_result(result)
        if self.ieee:
            result = self.ieee.annotate_result(result)
        return result


class PaperService:
    def __init__(self, session: Session, data_dir: Path, analysis_gateway: AnalysisGateway) -> None:
        self.session = session
        self.data_dir = data_dir
        self.analysis_gateway = analysis_gateway

    def import_paper(self, payload: PaperInput) -> PaperDetailResponse:
        paper = self._find_existing(payload)
        if not paper:
            paper = PaperTable(
                title=payload.title,
                authors=payload.authors,
                abstract=payload.abstract,
                year=payload.year,
                doi=payload.doi,
                venue=payload.venue,
                fields=payload.fields,
            )
            self.session.add(paper)
            self.session.commit()
            self.session.refresh(paper)
        else:
            paper.title = payload.title
            paper.authors = payload.authors
            paper.abstract = payload.abstract
            paper.year = payload.year
            paper.doi = payload.doi
            paper.venue = payload.venue
            paper.fields = payload.fields
            self.session.add(paper)
            self.session.commit()

        self.session.exec(delete(PaperSourceTable).where(PaperSourceTable.paper_id == paper.id))
        self.session.exec(delete(AccessCandidateTable).where(AccessCandidateTable.paper_id == paper.id))
        for item in payload.source_refs:
            self.session.add(
                PaperSourceTable(
                    paper_id=paper.id,
                    provider=item.provider,
                    external_id=item.external_id,
                    url=item.url,
                    score=item.score,
                )
            )
        for item in payload.access_candidates:
            self.session.add(
                AccessCandidateTable(
                    paper_id=paper.id,
                    kind=item.kind,
                    url=item.url,
                    license=item.license,
                    version=item.version,
                    source=item.source,
                )
            )
        self._record_usage("import", {"paper_id": paper.id})
        self.session.commit()
        return self.get_paper(paper.id)

    def get_paper(self, paper_id: str) -> PaperDetailResponse:
        paper = self.session.get(PaperTable, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
        return self._serialize_paper(paper)

    def list_library(self, *, query: str | None = None, collection_id: str | None = None):
        statement = select(PaperTable)
        if query:
            pattern = f"%{query}%"
            statement = statement.where(
                or_(PaperTable.title.ilike(pattern), PaperTable.abstract.ilike(pattern))
            )
        if collection_id:
            paper_ids = select(CollectionItemTable.paper_id).where(
                CollectionItemTable.collection_id == collection_id
            )
            statement = statement.where(PaperTable.id.in_(paper_ids))
        papers = list(self.session.exec(statement.order_by(PaperTable.created_at.desc())))
        return {"total": len(papers), "results": [self._serialize_paper(item) for item in papers]}

    def resolve_access(self, paper_id: str, access_resolver: AccessResolver) -> PaperDetailResponse:
        paper = self.session.get(PaperTable, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
        payload = self._serialize_paper(paper)
        from research_backend.services.search import SearchResult

        result = SearchResult(**payload.model_dump(exclude={"id", "document_asset", "latest_summary"}))
        resolved = access_resolver.annotate_result(result)
        self.session.exec(delete(AccessCandidateTable).where(AccessCandidateTable.paper_id == paper.id))
        for item in resolved.access_candidates:
            candidate = AccessCandidate.model_validate(item)
            self.session.add(
                AccessCandidateTable(
                    paper_id=paper.id,
                    kind=candidate.kind,
                    url=candidate.url,
                    license=candidate.license,
                    version=candidate.version,
                    source=candidate.source,
                )
            )
        self._record_usage("resolve_access", {"paper_id": paper.id})
        self.session.commit()
        return self.get_paper(paper.id)

    def download_asset(self, paper_id: str, *, url: str | None, file_path: str | None) -> DocumentAsset:
        paper = self.session.get(PaperTable, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
        target_dir = self.data_dir / "papers" / paper.id
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / "document.pdf"

        if file_path:
            source = Path(file_path)
            if source.suffix.lower() != ".pdf":
                raise HTTPException(status_code=400, detail="Downloaded content is not a PDF")
            shutil.copyfile(source, target_file)
        elif url:
            if not url.lower().endswith(".pdf"):
                raise HTTPException(status_code=400, detail="Downloaded content is not a PDF")
            response = httpx.get(url, timeout=60, follow_redirects=True)
            response.raise_for_status()
            if response.headers.get("content-type", "").lower() not in {
                "application/pdf",
                "application/octet-stream",
            } and not response.content.startswith(b"%PDF"):
                raise HTTPException(status_code=400, detail="Downloaded content is not a PDF")
            target_file.write_bytes(response.content)
        else:
            raise HTTPException(status_code=422, detail="Either url or file_path is required")

        text, pages = extract_pdf_text(target_file)
        checksum = hashlib.sha256(target_file.read_bytes()).hexdigest()
        asset = self.session.exec(
            select(DocumentAssetTable).where(DocumentAssetTable.paper_id == paper.id)
        ).first()
        if asset is None:
            asset = DocumentAssetTable(
                paper_id=paper.id,
                file_path=str(target_file),
                mime_type="application/pdf",
                checksum=checksum,
                pages=pages,
                text_status="ready" if text else "empty",
            )
        else:
            asset.file_path = str(target_file)
            asset.mime_type = "application/pdf"
            asset.checksum = checksum
            asset.pages = pages
            asset.text_status = "ready" if text else "empty"
        self.session.add(asset)
        self._record_usage("download", {"paper_id": paper.id})
        self.session.commit()
        return DocumentAsset(
            paper_id=paper.id,
            file_path=asset.file_path,
            mime_type=asset.mime_type,
            checksum=asset.checksum,
            pages=asset.pages,
            text_status=asset.text_status,
        )

    def summarize_paper(
        self,
        paper_id: str,
        *,
        model: str,
        provider: str,
        settings: dict[str, str] | None = None,
    ) -> dict:
        paper = self.session.get(PaperTable, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
        artifact = self._get_artifact(paper.id, kind="summary", model=model)
        if artifact and artifact.summary_md:
            return self._artifact_payload(paper.id, artifact)
        asset = self.session.exec(
            select(DocumentAssetTable).where(DocumentAssetTable.paper_id == paper.id)
        ).first()
        if not asset:
            raise HTTPException(status_code=400, detail="Paper has no downloaded PDF")
        text, _ = extract_pdf_text(Path(asset.file_path))
        try:
            result = self.analysis_gateway.summarize(
                text, model=model, provider=provider, settings=settings
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if artifact is None:
            artifact = AnalysisArtifactTable(
                paper_id=paper.id,
                kind="summary",
                model=model,
                summary_md=result.summary_md,
                extraction_json=result.extraction_json,
            )
        else:
            artifact.summary_md = result.summary_md
            artifact.extraction_json = result.extraction_json
        self.session.add(artifact)
        self._record_usage("summarize", {"paper_id": paper.id})
        try:
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            artifact = self._get_artifact(paper.id, kind="summary", model=model)
            if artifact is None:
                raise
            if artifact.summary_md is None:
                artifact.summary_md = result.summary_md
                artifact.extraction_json = result.extraction_json
                self.session.add(artifact)
                self._record_usage("summarize", {"paper_id": paper.id, "deduped": True, "recovered": True})
                self.session.commit()
                self.session.refresh(artifact)
                return self._artifact_payload(paper.id, artifact)
            self._record_usage("summarize", {"paper_id": paper.id, "deduped": True})
            self.session.commit()
            return self._artifact_payload(paper.id, artifact)
        self.session.refresh(artifact)
        return self._artifact_payload(paper.id, artifact)

    def extract_table(
        self,
        paper_id: str,
        *,
        model: str,
        provider: str,
        settings: dict[str, str] | None = None,
    ) -> dict:
        paper = self.session.get(PaperTable, paper_id)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")
        artifact = self._get_artifact(paper.id, kind="summary", model=model)
        if artifact and artifact.extraction_json:
            return artifact.extraction_json
        asset = self.session.exec(
            select(DocumentAssetTable).where(DocumentAssetTable.paper_id == paper.id)
        ).first()
        if not asset:
            raise HTTPException(status_code=400, detail="Paper has no downloaded PDF")
        text, _ = extract_pdf_text(Path(asset.file_path))
        try:
            extraction = self.analysis_gateway.extract_table(
                text, model=model, provider=provider, settings=settings
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if artifact is None:
            artifact = AnalysisArtifactTable(
                paper_id=paper.id,
                kind="summary",
                model=model,
                summary_md=None,
                extraction_json=extraction,
            )
        else:
            artifact.extraction_json = extraction
        self.session.add(artifact)
        self._record_usage("extract_table", {"paper_id": paper.id})
        try:
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            artifact = self._get_artifact(paper.id, kind="summary", model=model)
            if artifact is None or artifact.extraction_json is None:
                if artifact is None:
                    raise
                artifact.extraction_json = extraction
                self.session.add(artifact)
                self._record_usage(
                    "extract_table",
                    {"paper_id": paper.id, "deduped": True, "recovered": True},
                )
                self.session.commit()
                return artifact.extraction_json
            self._record_usage("extract_table", {"paper_id": paper.id, "deduped": True})
            self.session.commit()
            return artifact.extraction_json
        return extraction

    def create_collection(self, payload: CollectionCreate) -> dict:
        collection = CollectionTable(name=payload.name)
        self.session.add(collection)
        self.session.commit()
        self._record_usage("create_collection", {"collection_id": collection.id})
        self.session.commit()
        return {"id": collection.id, "name": collection.name, "paper_count": 0}

    def list_collections(self) -> dict:
        collections = list(self.session.exec(select(CollectionTable).order_by(CollectionTable.created_at.desc())))
        results = []
        for collection in collections:
            count = self.session.exec(
                select(func.count(CollectionItemTable.id)).where(
                    CollectionItemTable.collection_id == collection.id
                )
            ).one()
            results.append({"id": collection.id, "name": collection.name, "paper_count": count})
        return {"results": results}

    def add_paper_to_collection(self, collection_id: str, payload: CollectionItemCreate) -> dict:
        collection = self.session.get(CollectionTable, collection_id)
        if collection is None:
            raise HTTPException(status_code=404, detail="Collection not found")
        paper = self.session.get(PaperTable, payload.paper_id)
        if paper is None:
            raise HTTPException(status_code=404, detail="Paper not found")
        existing = self.session.exec(
            select(CollectionItemTable).where(
                CollectionItemTable.collection_id == collection_id,
                CollectionItemTable.paper_id == payload.paper_id,
            )
        ).first()
        if existing is None:
            self.session.add(CollectionItemTable(collection_id=collection_id, paper_id=payload.paper_id))
            self._record_usage("collection_assign", {"collection_id": collection_id, "paper_id": payload.paper_id})
            self.session.commit()
        count = self.session.exec(
            select(func.count(CollectionItemTable.id)).where(CollectionItemTable.collection_id == collection_id)
        ).one()
        return {"id": collection.id, "name": collection.name, "paper_count": count}

    def get_settings(self, defaults: dict[str, str] | None = None) -> dict:
        merged = dict(defaults or {})
        merged.update({item.key: item.value for item in self.session.exec(select(SettingTable))})
        return merged

    def update_settings(self, payload: SettingsPayload, defaults: dict[str, str] | None = None) -> dict:
        for key, value in payload.model_dump(exclude_none=True).items():
            setting = self.session.get(SettingTable, key)
            if setting is None:
                setting = SettingTable(key=key, value=str(value))
            else:
                setting.value = str(value)
            self.session.add(setting)
        self._record_usage("settings_update", payload.model_dump(exclude_none=True))
        self.session.commit()
        return self.get_settings(defaults=defaults)

    def get_usage(self) -> dict:
        rows = self.session.exec(
            select(UsageEventTable.kind, func.count(UsageEventTable.id)).group_by(UsageEventTable.kind)
        ).all()
        return {"events": {kind: count for kind, count in rows}}

    def export_library_json(self) -> LibraryExport:
        collections = self.list_collections()["results"]
        papers = [
            self._paper_input_from_detail(item)
            for item in self.list_library()["results"]
        ]
        return LibraryExport(papers=papers, collections=collections)

    def export_library_bibtex(self) -> str:
        entries = []
        for paper in self.list_library()["results"]:
            authors = " and ".join(paper.authors)
            key = (paper.doi or paper.title).replace("/", "_").replace(" ", "_")
            entries.append(
                "\n".join(
                    [
                        f"@article{{{key},",
                        f"  title = {{{paper.title}}},",
                        f"  author = {{{authors}}},",
                        f"  year = {{{paper.year or ''}}},",
                        f"  journal = {{{paper.venue or ''}}},",
                        f"  doi = {{{paper.doi or ''}}},",
                        "}",
                    ]
                )
            )
        return "\n\n".join(entries)

    def import_library_json(self, payload: LibraryExport) -> dict:
        imported_papers = 0
        imported_collections = 0
        for paper in payload.papers:
            existing = self._find_existing(paper)
            if existing is None:
                imported_papers += 1
            self.import_paper(paper)
        for collection in payload.collections:
            existing_collection = self.session.get(CollectionTable, collection.id)
            if existing_collection is None:
                self.session.add(CollectionTable(id=collection.id, name=collection.name))
                imported_collections += 1
        self._record_usage(
            "library_import",
            {"imported_papers": imported_papers, "imported_collections": imported_collections},
        )
        self.session.commit()
        return {
            "imported_papers": imported_papers,
            "imported_collections": imported_collections,
        }

    def _find_existing(self, payload: PaperInput) -> PaperTable | None:
        if payload.doi:
            existing = self.session.exec(select(PaperTable).where(PaperTable.doi == payload.doi)).first()
            if existing:
                return existing
        return self.session.exec(
            select(PaperTable).where(
                PaperTable.title == payload.title,
                PaperTable.year == payload.year,
            )
        ).first()

    def _serialize_paper(self, paper: PaperTable) -> PaperDetailResponse:
        source_refs = list(
            self.session.exec(select(PaperSourceTable).where(PaperSourceTable.paper_id == paper.id))
        )
        access_candidates = list(
            self.session.exec(select(AccessCandidateTable).where(AccessCandidateTable.paper_id == paper.id))
        )
        asset = self.session.exec(
            select(DocumentAssetTable).where(DocumentAssetTable.paper_id == paper.id)
        ).first()
        summary = self.session.exec(
            select(AnalysisArtifactTable)
            .where(AnalysisArtifactTable.paper_id == paper.id, AnalysisArtifactTable.kind == "summary")
            .order_by(AnalysisArtifactTable.created_at.desc())
        ).first()
        return PaperDetailResponse(
            id=paper.id,
            title=paper.title,
            authors=paper.authors,
            abstract=paper.abstract,
            year=paper.year,
            doi=paper.doi,
            venue=paper.venue,
            fields=paper.fields,
            source_refs=[
                {
                    "provider": item.provider,
                    "external_id": item.external_id,
                    "url": item.url,
                    "score": item.score,
                }
                for item in source_refs
            ],
            access_candidates=[
                {
                    "kind": item.kind,
                    "url": item.url,
                    "license": item.license,
                    "version": item.version,
                    "source": item.source,
                }
                for item in access_candidates
            ],
            document_asset=(
                DocumentAsset(
                    paper_id=paper.id,
                    file_path=asset.file_path,
                    mime_type=asset.mime_type,
                    checksum=asset.checksum,
                    pages=asset.pages,
                    text_status=asset.text_status,
                )
                if asset
                else None
            ),
            latest_summary=(
                {
                    "paper_id": paper.id,
                    "model": summary.model,
                    "summary_md": summary.summary_md,
                    "extraction_json": summary.extraction_json,
                    "created_at": summary.created_at,
                }
                if summary
                else None
            ),
        )

    def _artifact_payload(self, paper_id: str, artifact: AnalysisArtifactTable) -> dict:
        return {
            "paper_id": paper_id,
            "model": artifact.model,
            "summary_md": artifact.summary_md,
            "extraction_json": artifact.extraction_json,
            "created_at": artifact.created_at,
        }

    def _get_artifact(self, paper_id: str, *, kind: str, model: str) -> AnalysisArtifactTable | None:
        return self.session.exec(
            select(AnalysisArtifactTable).where(
                AnalysisArtifactTable.paper_id == paper_id,
                AnalysisArtifactTable.kind == kind,
                AnalysisArtifactTable.model == model,
                AnalysisArtifactTable.prompt_version == "v1",
            )
        ).first()

    def _record_usage(self, kind: str, payload: dict) -> None:
        self.session.add(UsageEventTable(kind=kind, payload=payload))

    def _paper_input_from_detail(self, paper: PaperDetailResponse) -> PaperInput:
        return PaperInput(
            title=paper.title,
            authors=paper.authors,
            abstract=paper.abstract,
            year=paper.year,
            doi=paper.doi,
            venue=paper.venue,
            fields=paper.fields,
            source_refs=paper.source_refs,
            access_candidates=paper.access_candidates,
        )

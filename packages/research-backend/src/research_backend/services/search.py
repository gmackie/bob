from collections.abc import Iterable
from dataclasses import dataclass

from pydantic import BaseModel, Field

from research_backend.schemas.api import AccessCandidate, SourceRef
from research_backend.services.providers import ProviderWarning


class SearchResult(BaseModel):
    title: str
    authors: list[str] = Field(default_factory=list)
    abstract: str | None = None
    year: int | None = None
    doi: str | None = None
    venue: str | None = None
    fields: list[str] = Field(default_factory=list)
    source_refs: list[SourceRef | dict] = Field(default_factory=list)
    access_candidates: list[AccessCandidate | dict] = Field(default_factory=list)

    def dedupe_key(self) -> str:
        if self.doi:
            return self.doi.lower()
        normalized_title = "".join(ch.lower() for ch in self.title if ch.isalnum() or ch.isspace()).strip()
        return f"{normalized_title}:{self.year or 'unknown'}"

    def merged(self, other: "SearchResult") -> "SearchResult":
        source_refs = [SourceRef.model_validate(item).model_dump() for item in self.source_refs]
        access_candidates = [AccessCandidate.model_validate(item).model_dump() for item in self.access_candidates]

        for item in other.source_refs:
            candidate = SourceRef.model_validate(item).model_dump()
            if candidate not in source_refs:
                source_refs.append(candidate)
        for item in other.access_candidates:
            candidate = AccessCandidate.model_validate(item).model_dump()
            if candidate not in access_candidates:
                access_candidates.append(candidate)

        merged_fields = list(dict.fromkeys([*self.fields, *other.fields]))
        merged_authors = list(dict.fromkeys([*self.authors, *other.authors]))
        return SearchResult(
            title=self.title if len(self.title) >= len(other.title) else other.title,
            authors=merged_authors,
            abstract=self.abstract or other.abstract,
            year=self.year or other.year,
            doi=self.doi or other.doi,
            venue=self.venue or other.venue,
            fields=merged_fields,
            source_refs=source_refs,
            access_candidates=access_candidates,
        )


class SearchResponse(BaseModel):
    results: list[SearchResult]
    warnings: list[ProviderWarning] = Field(default_factory=list)


@dataclass
class SearchGateway:
    providers: list
    access_resolver: object | None = None

    def search(self, query: str, *, sources: list[str] | None, page: int) -> SearchResponse:
        merged: dict[str, SearchResult] = {}
        warnings: list[ProviderWarning] = []

        for provider in self.providers:
            if sources and provider.name not in sources:
                continue
            try:
                results = provider.search(query, page=page)
            except Exception as exc:  # pragma: no cover - network/runtime safety
                warnings.append(ProviderWarning(provider=provider.name, message=str(exc)))
                continue
            for raw_result in results:
                result = raw_result if isinstance(raw_result, SearchResult) else SearchResult(**raw_result)
                key = result.dedupe_key()
                merged[key] = merged[key].merged(result) if key in merged else result

        resolved_results = list(merged.values())
        if self.access_resolver:
            resolved_results = [self.access_resolver.annotate_result(result) for result in resolved_results]

        resolved_results.sort(key=lambda item: ((item.year or 0) * -1, item.title.lower()))
        return SearchResponse(results=resolved_results, warnings=warnings)


def normalize_results(items: Iterable[SearchResult]) -> list[dict]:
    return [item.model_dump() for item in items]

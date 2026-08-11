from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from research_backend.routes import search as search_route


class _Result:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[Any, ...]]:
        return self._rows


class _Session:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def exec(self, statement: Any, params: dict[str, Any]) -> _Result:
        self.calls.append((str(statement), params))
        return _Result(self.rows)


def _request() -> Any:
    settings = SimpleNamespace(
        ollama_base_url="http://ollama.test",
        ollama_embedding_model="nomic-embed-text",
    )
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=settings)))


def test_paper_search_ranks_in_postgres_with_pgvector(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        search_route,
        "_ollama_embed_single",
        lambda *_args, **_kwargs: np.zeros(768, dtype=np.float32),
    )
    session = _Session([(1, "Title", "paper-s2", None, None, None, "s2", "doi", 0.5, 0.9)])

    result = search_route.search_papers(
        request=_request(),
        query="vector search",
        schema="research_vault",
        year_from=None,
        min_influence=None,
        limit=20,
        session=session,
    )

    sql, params = session.calls[0]
    assert "research_vault.source_embedding" in sql
    assert "<=>" in sql
    assert "ORDER BY e.embedding" in sql
    assert "research_vault.embeddings" not in sql
    assert params["query_embedding"].startswith("[")
    assert result["fallback"] is False
    assert result["papers"][0]["score"] == 0.9


def test_paper_search_fallback_is_a_bounded_database_query(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        search_route,
        "_ollama_embed_single",
        lambda *_args, **_kwargs: None,
    )
    session = _Session([])

    result = search_route.search_papers(
        request=_request(),
        query="fallback",
        schema="research_vault",
        year_from=None,
        min_influence=None,
        limit=5,
        session=session,
    )

    sql, params = session.calls[0]
    assert "ILIKE" in sql
    assert "LIMIT" in sql
    assert params["limit"] == 5
    assert result == {"papers": [], "fallback": True}


def test_source_search_route_exists() -> None:
    assert hasattr(search_route, "search_sources")


@pytest.mark.skipif(
    not hasattr(search_route, "search_sources"),
    reason="source search has not been implemented yet",
)
def test_source_search_ranks_in_postgres_and_classifies_private_kinds(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(
        search_route,
        "_ollama_embed_single",
        lambda *_args, **_kwargs: np.zeros(768, dtype=np.float32),
    )
    session = _Session(
        [
            (1, "youtube", "Public video", "Video excerpt", None, "Creator", None, 0.91),
            (
                2,
                "chat-import",
                "Imported conversation",
                "Private excerpt",
                None,
                None,
                None,
                0.88,
            ),
        ]
    )

    result = search_route.search_sources(
        request=_request(),
        query="voice-first memory",
        limit=8,
        session=session,
    )

    sql, params = session.calls[0]
    assert "research_vault.source_embedding" in sql
    assert "ORDER BY e.embedding" in sql
    assert "LIMIT :limit" in sql
    assert params["limit"] == 8
    assert result["fallback"] is False
    assert [source["sensitivity"] for source in result["sources"]] == [
        "general",
        "personal",
    ]
    assert result["sources"][1]["excerpt"] == "Private excerpt"


@pytest.mark.skipif(
    not hasattr(search_route, "search_sources"),
    reason="source search has not been implemented yet",
)
def test_source_search_fallback_is_bounded_and_keeps_files_personal(
    monkeypatch: Any,
) -> None:
    monkeypatch.setattr(search_route, "_ollama_embed_single", lambda *_args, **_kwargs: None)
    session = _Session([(3, "file", "Private note", "Note excerpt", None, None, None, 1.0)])

    result = search_route.search_sources(
        request=_request(),
        query="private note",
        limit=5,
        session=session,
    )

    sql, params = session.calls[0]
    assert "ILIKE" in sql
    assert "LIMIT :limit" in sql
    assert params["limit"] == 5
    assert result["fallback"] is True
    assert result["sources"][0]["sensitivity"] == "personal"

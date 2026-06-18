"""Tests for ``research_backend.s2.ingest``.

* Unit tests (always run): exercise the pure normalization helpers.
* Integration tests (DB-gated): exercise :func:`upsert_s2_paper` against a
  live Postgres referenced by ``DATABASE_URL``. Gated via ``skip_no_db`` so
  CI/dev machines without a DB still get the unit coverage.

The integration fixture mirrors ``tests/test_s2_cache.py``: it builds an
engine directly from ``DATABASE_URL`` (no ``Settings`` dependency) and
cleans up inserted rows in a ``try/finally``. Each test uses a unique S2 id
derived from ``uuid.uuid4()`` so concurrent runs do not collide.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from research_backend.s2.ingest import (
    compute_content_hash,
    normalize_graph_node_row,
    normalize_sources_row,
    upsert_s2_paper,
)

# ---------------------------------------------------------------------------
# Unit tests — always run, no DB required
# ---------------------------------------------------------------------------


def _paper(
    paper_id: str = "s2abc",
    doi: str | None = "10.1038/nature12373",
    title: str = "A title",
    abstract: str | None = "An abstract.",
    tldr_text: str | None = None,
    year: int | None = 2024,
    authors: list[dict] | None = None,
    citation_count: int = 10,
    influential: int = 2,
    url: str = "https://example.org/paper",
) -> dict:
    """Build a minimal S2-shaped paper dict for tests."""
    p: dict = {
        "paperId": paper_id,
        "title": title,
        "abstract": abstract,
        "year": year,
        "citationCount": citation_count,
        "influentialCitationCount": influential,
        "url": url,
        "authors": authors if authors is not None else [{"name": "First Author"}],
    }
    if doi is not None:
        p["externalIds"] = {"DOI": doi, "CorpusId": "123"}
    if tldr_text is not None:
        p["tldr"] = {"text": tldr_text}
    return p


def test_content_hash_prefers_doi():
    with_doi = _paper(paper_id="s2xxx", doi="10.1/abc")
    without_doi = _paper(paper_id="s2xxx", doi=None)
    assert compute_content_hash(with_doi) != compute_content_hash(without_doi)


def test_content_hash_dedups_same_doi_different_s2_id():
    p1 = _paper(paper_id="s2aaa", doi="10.1/same")
    p2 = _paper(paper_id="s2bbb", doi="10.1/same")
    assert compute_content_hash(p1) == compute_content_hash(p2)


def test_content_hash_doi_case_insensitive_and_trimmed():
    p1 = _paper(doi="10.1038/Nature12373")
    p2 = _paper(doi="  10.1038/nature12373 ")
    assert compute_content_hash(p1) == compute_content_hash(p2)


def test_content_hash_without_doi_or_paper_id_raises():
    with pytest.raises(ValueError):
        compute_content_hash({})


def test_normalize_sources_row_full_fields():
    row = normalize_sources_row(_paper())
    assert row["kind"] == "paper-s2"
    assert row["external_id"] == "s2abc"
    assert row["title"] == "A title"
    assert row["body"] == "An abstract."
    assert row["url"] == "https://example.org/paper"
    assert row["author"] == "First Author"
    assert row["source_ts"] == datetime(2024, 1, 1, tzinfo=timezone.utc)
    # Hex sha256 is 64 chars.
    assert len(row["content_hash"]) == 64


def test_normalize_sources_row_defaults_missing_title():
    row = normalize_sources_row(_paper(title=""))
    # Empty string is falsy → default sentinel.
    assert row["title"] == "(untitled)"


def test_normalize_sources_row_body_falls_back_to_tldr():
    row = normalize_sources_row(_paper(abstract=None, tldr_text="TL;DR text"))
    assert row["body"] == "TL;DR text"


def test_normalize_sources_row_body_empty_when_no_abstract_or_tldr():
    row = normalize_sources_row(_paper(abstract=None, tldr_text=None))
    assert row["body"] == ""


def test_normalize_sources_row_author_none_when_no_authors():
    row = normalize_sources_row(_paper(authors=[]))
    assert row["author"] is None


def test_normalize_sources_row_author_none_when_first_author_nameless():
    row = normalize_sources_row(_paper(authors=[{"authorId": "a1"}]))
    assert row["author"] is None


def test_normalize_sources_row_year_to_ts_none_when_year_missing():
    row = normalize_sources_row(_paper(year=None))
    assert row["source_ts"] is None


def test_normalize_sources_row_year_zero_treated_as_missing():
    row = normalize_sources_row(_paper(year=0))
    assert row["source_ts"] is None


def test_normalize_sources_row_missing_paper_id_raises():
    with pytest.raises(ValueError):
        normalize_sources_row({"title": "No id"})


def test_normalize_graph_node_row_influence_score_typical():
    node = normalize_graph_node_row(
        _paper(citation_count=10, influential=2), source_id=42
    )
    assert node["source_id"] == 42
    assert node["s2_paper_id"] == "s2abc"
    assert node["doi"] == "10.1038/nature12373"
    assert node["openalex_id"] is None
    assert node["influence_score"] == pytest.approx(0.2)
    assert node["first_seen_exploration"] is None


def test_normalize_graph_node_row_influence_score_zero_citations():
    # citationCount=0 with influential>0 — clamp via max(citations,1) + cap.
    node = normalize_graph_node_row(
        _paper(citation_count=0, influential=3), source_id=1
    )
    # max(0,1)=1 → 3/1 = 3 → clamped to 1.0
    assert node["influence_score"] == 1.0


def test_normalize_graph_node_row_influence_score_zero_influential():
    node = normalize_graph_node_row(
        _paper(citation_count=100, influential=0), source_id=1
    )
    assert node["influence_score"] == 0.0


def test_normalize_graph_node_row_influence_score_both_zero():
    node = normalize_graph_node_row(
        _paper(citation_count=0, influential=0), source_id=1
    )
    assert node["influence_score"] == 0.0


def test_normalize_graph_node_row_influence_score_missing_counts():
    p = _paper()
    p.pop("citationCount", None)
    p.pop("influentialCitationCount", None)
    node = normalize_graph_node_row(p, source_id=1)
    assert node["influence_score"] == 0.0


def test_normalize_graph_node_row_passes_through_exploration_id():
    eid = uuid.uuid4()
    node = normalize_graph_node_row(_paper(), source_id=1, first_seen_exploration=eid)
    assert node["first_seen_exploration"] == eid


def test_normalize_graph_node_row_doi_none_when_absent():
    node = normalize_graph_node_row(_paper(doi=None), source_id=1)
    assert node["doi"] is None


# ---------------------------------------------------------------------------
# Integration tests — require DATABASE_URL + research_vault tables + enum
# ---------------------------------------------------------------------------

skip_no_db = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="integration test requires DATABASE_URL",
)


@pytest.fixture
def ingest_db_fixture():
    """Yield ``(session_factory, schema, cleanup)`` for integration tests.

    The ``cleanup`` callable takes a list of S2 paper ids and removes any
    ``sources`` (and thus cascading ``graph_node``) rows that match.
    """
    from sqlmodel import Session, create_engine

    url = os.environ["DATABASE_URL"]
    engine = create_engine(url, echo=False)
    schema = "research_vault"

    def session_factory():
        return Session(engine)

    created_s2_ids: list[str] = []

    def register(s2_id: str) -> None:
        created_s2_ids.append(s2_id)

    try:
        yield session_factory, schema, register
    finally:
        if created_s2_ids:
            with session_factory() as s:
                s.execute(
                    text(
                        f"DELETE FROM {schema}.sources "
                        f"WHERE kind = 'paper-s2' AND external_id = ANY(:ids)"
                    ),
                    {"ids": created_s2_ids},
                )
                s.commit()
        engine.dispose()


@skip_no_db
def test_upsert_s2_paper_creates_new_source_and_node(ingest_db_fixture):
    session_factory, schema, register = ingest_db_fixture
    s2_id = f"test-{uuid.uuid4().hex}"
    register(s2_id)
    paper = _paper(paper_id=s2_id, doi=f"10.9999/{s2_id}")

    with session_factory() as s:
        source_id = upsert_s2_paper(s, schema, paper)

    assert isinstance(source_id, int)
    assert source_id > 0

    with session_factory() as s:
        src = s.execute(
            text(
                f"SELECT id, kind, external_id, title, body "
                f"FROM {schema}.sources WHERE id = :id"
            ),
            {"id": source_id},
        ).first()
        assert src is not None
        assert src.kind == "paper-s2"
        assert src.external_id == s2_id
        assert src.title == "A title"
        assert src.body == "An abstract."

        node = s.execute(
            text(
                f"SELECT source_id, s2_paper_id, doi, influence_score "
                f"FROM {schema}.graph_node WHERE source_id = :id"
            ),
            {"id": source_id},
        ).first()
        assert node is not None
        assert node.s2_paper_id == s2_id
        assert node.doi == f"10.9999/{s2_id}"
        assert node.influence_score == pytest.approx(0.2)


@skip_no_db
def test_upsert_idempotent_on_same_paper(ingest_db_fixture):
    session_factory, schema, register = ingest_db_fixture
    s2_id = f"test-{uuid.uuid4().hex}"
    register(s2_id)
    paper = _paper(paper_id=s2_id, doi=f"10.9999/{s2_id}")

    with session_factory() as s:
        first_id = upsert_s2_paper(s, schema, paper)
    with session_factory() as s:
        second_id = upsert_s2_paper(s, schema, paper)

    assert first_id == second_id

    with session_factory() as s:
        count = s.execute(
            text(
                f"SELECT COUNT(*) AS n FROM {schema}.sources "
                f"WHERE kind = 'paper-s2' AND external_id = :eid"
            ),
            {"eid": s2_id},
        ).scalar_one()
        assert count == 1

        node_count = s.execute(
            text(
                f"SELECT COUNT(*) AS n FROM {schema}.graph_node "
                f"WHERE source_id = :id"
            ),
            {"id": first_id},
        ).scalar_one()
        assert node_count == 1


@skip_no_db
def test_upsert_updates_citation_count_on_second_call(ingest_db_fixture):
    session_factory, schema, register = ingest_db_fixture
    s2_id = f"test-{uuid.uuid4().hex}"
    register(s2_id)
    paper = _paper(
        paper_id=s2_id,
        doi=f"10.9999/{s2_id}",
        citation_count=10,
        influential=1,  # score = 0.1
    )

    with session_factory() as s:
        first_id = upsert_s2_paper(s, schema, paper)

    # Second call with updated counts.
    paper["citationCount"] = 20
    paper["influentialCitationCount"] = 10  # score = 0.5

    with session_factory() as s:
        second_id = upsert_s2_paper(s, schema, paper)

    assert first_id == second_id

    with session_factory() as s:
        score = s.execute(
            text(
                f"SELECT influence_score FROM {schema}.graph_node "
                f"WHERE source_id = :id"
            ),
            {"id": first_id},
        ).scalar_one()
        assert score == pytest.approx(0.5)


@skip_no_db
def test_upsert_different_s2_ids_same_doi_yields_one_row(ingest_db_fixture):
    session_factory, schema, register = ingest_db_fixture
    # Register both S2 ids for cleanup — only one survives but cleanup must
    # be defensive.
    s2_id_1 = f"test-{uuid.uuid4().hex}"
    s2_id_2 = f"test-{uuid.uuid4().hex}"
    register(s2_id_1)
    register(s2_id_2)

    shared_doi = f"10.9999/shared-{uuid.uuid4().hex}"

    paper_1 = _paper(paper_id=s2_id_1, doi=shared_doi, title="First variant")
    paper_2 = _paper(paper_id=s2_id_2, doi=shared_doi, title="Second variant")

    with session_factory() as s:
        first_id = upsert_s2_paper(s, schema, paper_1)
    with session_factory() as s:
        second_id = upsert_s2_paper(s, schema, paper_2)

    # Same content_hash → same row.
    assert first_id == second_id

    with session_factory() as s:
        # Only one row with this content_hash.
        count = s.execute(
            text(
                f"SELECT COUNT(*) AS n FROM {schema}.sources "
                f"WHERE id = :id"
            ),
            {"id": first_id},
        ).scalar_one()
        assert count == 1

        # Title was updated to the second variant.
        title = s.execute(
            text(f"SELECT title FROM {schema}.sources WHERE id = :id"),
            {"id": first_id},
        ).scalar_one()
        assert title == "Second variant"

        # graph_node exists for the source; s2_paper_id reflects most recent
        # upsert (paper_2).
        s2_paper_id = s.execute(
            text(
                f"SELECT s2_paper_id FROM {schema}.graph_node "
                f"WHERE source_id = :id"
            ),
            {"id": first_id},
        ).scalar_one()
        assert s2_paper_id == s2_id_2

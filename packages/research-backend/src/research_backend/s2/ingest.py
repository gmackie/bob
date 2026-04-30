"""Normalize Semantic Scholar paper JSON into per-vault ``sources`` + ``graph_node`` rows.

The public entry point is :func:`upsert_s2_paper`, which is idempotent on the
paper's dedup key (DOI preferred, S2 ``paperId`` as fallback). A second call
with the same logical paper — even via a different S2 id but matching DOI —
updates the existing row instead of creating a duplicate.

Design notes
------------
* **Mixed ORM / raw SQL.** The per-vault ``sources`` table is owned by Drizzle
  and has no SQLAlchemy model on the Python side (see
  ``packages/research-backend/src/research_backend/db_models/records.py`` —
  only SQLModel tables in the ``public`` schema are modelled). We therefore
  upsert ``sources`` via raw ``sqlalchemy.text`` with
  ``ON CONFLICT (kind, external_id) DO UPDATE ... RETURNING id``. The
  ``graph_node`` table *is* modelled (see
  ``db_models.buddy.build_vault_buddy_models``) but the cleanest path for an
  ``ON CONFLICT (source_id)`` upsert is still a parameterised ``text`` call —
  SQLAlchemy 2.x ORM doesn't expose a portable conflict-target API without
  pulling in the ``postgresql`` dialect helpers, and the raw-SQL path keeps
  this module aligned with :mod:`research_backend.s2.cache`.
* **Dedup key.** ``content_hash`` is ``sha256(doi)`` when DOI is present, else
  ``sha256(s2_paper_id)``. Two S2 records that resolve to the same DOI share
  the same hash. The ``(kind, external_id)`` unique index on ``sources`` is
  keyed on S2 id so a DOI-only dedup additionally requires picking the same
  ``external_id`` — we look up by ``content_hash`` first and short-circuit to
  reuse the existing row when found.
* **Transactionality.** Both upserts run in a single session transaction. The
  caller may supply a live ``Session`` (committed at the end) or a session
  factory; we commit at the end so an exception between steps rolls back.
* **Normalization helpers** (``normalize_sources_row``,
  ``normalize_graph_node_row``, ``compute_content_hash``) are pure functions
  exported for unit tests. They never touch the database.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

__all__ = [
    "compute_content_hash",
    "normalize_sources_row",
    "normalize_graph_node_row",
    "upsert_s2_paper",
]

_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})


def compute_content_hash(paper: dict[str, Any]) -> str:
    """Return the dedup hash for ``paper``.

    DOI is preferred — two S2 records that canonicalize to the same DOI yield
    the same hash. Falls back to the S2 ``paperId`` when no DOI is present.
    The returned string is the full 64-char hex digest of SHA-256.
    """
    doi = (paper.get("externalIds") or {}).get("DOI")
    if doi:
        seed = f"doi:{doi.strip().lower()}"
    else:
        s2_id = paper.get("paperId")
        if not s2_id:
            raise ValueError("paper must have either DOI or paperId for content_hash")
        seed = f"s2:{s2_id}"
    return hashlib.sha256(seed.encode()).hexdigest()


def _first_author_name(paper: dict[str, Any]) -> str | None:
    authors = paper.get("authors") or []
    if not authors:
        return None
    first = authors[0]
    if isinstance(first, dict):
        name = first.get("name")
        if isinstance(name, str) and name.strip():
            return name
    return None


def _abstract_or_tldr(paper: dict[str, Any]) -> str:
    """Return the best available body text.

    Prefers ``abstract``; falls back to ``tldr.text``; empty string as a last
    resort because ``sources.body`` is NOT NULL in the Drizzle schema.
    """
    abstract = paper.get("abstract")
    if isinstance(abstract, str) and abstract.strip():
        return abstract
    tldr = paper.get("tldr")
    if isinstance(tldr, dict):
        text_val = tldr.get("text")
        if isinstance(text_val, str) and text_val.strip():
            return text_val
    return ""


def _year_to_source_ts(paper: dict[str, Any]) -> datetime | None:
    year = paper.get("year")
    if not isinstance(year, int):
        return None
    # S2 occasionally returns 0 for unknown year; treat as missing.
    if year <= 0:
        return None
    return datetime(year, 1, 1, tzinfo=timezone.utc)


def normalize_sources_row(paper: dict[str, Any]) -> dict[str, Any]:
    """Project an S2 paper JSON into the shape of a per-vault ``sources`` row.

    Returned keys match the Drizzle column names (snake_case) so the dict can
    feed a parameterised ``INSERT`` without remapping. All values are either
    primitives or ``datetime`` — no ORM types.
    """
    s2_id = paper.get("paperId")
    if not s2_id:
        raise ValueError("paper is missing required field 'paperId'")

    return {
        "kind": "paper-s2",
        "external_id": s2_id,
        "title": paper.get("title") or "(untitled)",
        "body": _abstract_or_tldr(paper),
        "url": paper.get("url"),
        "author": _first_author_name(paper),
        "source_ts": _year_to_source_ts(paper),
        "content_hash": compute_content_hash(paper),
    }


def _influence_score(paper: dict[str, Any]) -> float:
    """Cheap heuristic: influential / max(citations, 1).

    Clamped at 1.0 for the unusual case where influential > citations (can
    happen when S2 updates one counter ahead of the other). We also handle
    the ``citationCount=0, influentialCitationCount>0`` edge case by falling
    back to the raw influential count (still capped at 1.0).
    """
    influential = paper.get("influentialCitationCount") or 0
    citations = paper.get("citationCount") or 0
    if influential <= 0:
        return 0.0
    denom = max(citations, 1)
    score = influential / denom
    return float(min(score, 1.0))


def normalize_graph_node_row(
    paper: dict[str, Any],
    source_id: int,
    first_seen_exploration: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Project an S2 paper JSON into the shape of a per-vault ``graph_node`` row."""
    s2_id = paper.get("paperId")
    if not s2_id:
        raise ValueError("paper is missing required field 'paperId'")
    external_ids = paper.get("externalIds") or {}
    return {
        "source_id": source_id,
        "s2_paper_id": s2_id,
        "openalex_id": None,
        "doi": external_ids.get("DOI"),
        "influence_score": _influence_score(paper),
        "first_seen_exploration": first_seen_exploration,
    }


# ---------------------------------------------------------------------------
# Database upsert
# ---------------------------------------------------------------------------


def upsert_s2_paper(
    session: Any,
    vault_schema: str,
    paper: dict[str, Any],
    first_seen_exploration: uuid.UUID | None = None,
) -> int:
    """Upsert an S2 paper into ``{schema}.sources`` + ``{schema}.graph_node``.

    Idempotent on the paper's dedup key (DOI preferred; S2 id as fallback).
    Returns the integer ``source_id`` whether the row was inserted or updated.

    Both upserts run inside the caller's ``session``; we ``commit`` before
    returning so any intermediate failure rolls back cleanly. The caller is
    expected to supply a Session-like object with ``execute`` and ``commit``
    methods (``sqlmodel.Session`` or ``sqlalchemy.orm.Session``).
    """
    if vault_schema not in _VALID_SCHEMAS:
        raise ValueError(f"invalid vault schema: {vault_schema!r}")

    sources_row = normalize_sources_row(paper)

    # Step 1: look up by content_hash first. This catches the "same DOI,
    # different S2 id" case — the (kind, external_id) unique index alone
    # would allow a duplicate because the S2 id differs.
    existing = session.execute(
        text(
            f"SELECT id FROM {vault_schema}.sources WHERE content_hash = :h LIMIT 1"
        ),
        {"h": sources_row["content_hash"]},
    ).first()

    if existing is not None:
        source_id = int(existing.id)
        # Update mutable metadata (title may have been refined, url corrected,
        # etc.) but keep id + kind + external_id stable.
        session.execute(
            text(
                f"""
                UPDATE {vault_schema}.sources
                   SET title = :title,
                       body = :body,
                       url = :url,
                       author = :author,
                       source_ts = :source_ts
                 WHERE id = :id
                """
            ),
            {
                "title": sources_row["title"],
                "body": sources_row["body"],
                "url": sources_row["url"],
                "author": sources_row["author"],
                "source_ts": sources_row["source_ts"],
                "id": source_id,
            },
        )
    else:
        # Step 2: insert, handling the (kind, external_id) race where another
        # writer inserted the same S2 id concurrently.
        row = session.execute(
            text(
                f"""
                INSERT INTO {vault_schema}.sources
                    (kind, external_id, title, body, url, author,
                     source_ts, content_hash)
                VALUES (:kind, :external_id, :title, :body, :url, :author,
                        :source_ts, :content_hash)
                ON CONFLICT (kind, external_id) DO UPDATE
                  SET title = EXCLUDED.title,
                      body = EXCLUDED.body,
                      url = EXCLUDED.url,
                      author = EXCLUDED.author,
                      source_ts = EXCLUDED.source_ts,
                      content_hash = EXCLUDED.content_hash
                RETURNING id
                """
            ),
            sources_row,
        ).first()
        if row is None:
            raise RuntimeError(
                "sources upsert returned no row; expected RETURNING id"
            )
        source_id = int(row.id)

    # Step 3: upsert graph_node keyed on source_id.
    node_row = normalize_graph_node_row(paper, source_id, first_seen_exploration)
    session.execute(
        text(
            f"""
            INSERT INTO {vault_schema}.graph_node
                (source_id, s2_paper_id, openalex_id, doi,
                 influence_score, first_seen_exploration)
            VALUES (:source_id, :s2_paper_id, :openalex_id, :doi,
                    :influence_score, :first_seen_exploration)
            ON CONFLICT (source_id) DO UPDATE
              SET s2_paper_id = EXCLUDED.s2_paper_id,
                  doi = COALESCE(EXCLUDED.doi, {vault_schema}.graph_node.doi),
                  influence_score = EXCLUDED.influence_score,
                  first_seen_exploration = COALESCE(
                    {vault_schema}.graph_node.first_seen_exploration,
                    EXCLUDED.first_seen_exploration
                  )
            """
        ),
        node_row,
    )

    session.commit()
    return source_id

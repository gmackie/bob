# ruff: noqa: N806  (we bind dynamically-created ORM classes to CamelCase locals)
"""SQLAlchemy 2.x declarative mirrors for research-buddy tables.

Source of truth: ``packages/db/drizzle/0003_research_buddy_schema.sql``.
These classes mirror the Drizzle-generated schema so the Python backend
can read/write the same tables.

Design notes
------------
* Uses SQLAlchemy 2.x :class:`DeclarativeBase` on a **dedicated** registry,
  not SQLModel's ``SQLModel.metadata``. This is deliberate: the existing
  ``init_db`` calls ``SQLModel.metadata.create_all(engine)`` for
  public-schema SQLModel tables, and must NOT accidentally create these
  Drizzle-owned tables on top.
* Source id columns (``graph_node.source_id``, ``graph_edge.from/to_source_id``,
  ``findings_inbox.source_id``, ``standing_interest.seed_source_ids``) are
  ``Integer`` because ``sources.id`` is ``SERIAL`` (see task 1.2). **Not** UUID.
* ``thread_link_kind`` enum has exactly 4 values — no ``cold_thread_update``
  (that's computed dashboard-side, not persisted).
* Per-vault models are built by :func:`build_vault_buddy_models`. Repeated
  calls for the same schema return cached classes; calls for different
  schemas produce distinct classes with schema-suffixed class names so they
  don't collide in the shared SQLAlchemy registry.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import (
    ARRAY,
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase

__all__ = [
    "BuddyBase",
    "EXPLORATION_STATUS_VALUES",
    "THREAD_LINK_KIND_VALUES",
    "GRAPH_EDGE_KIND_VALUES",
    "FINDINGS_TRIAGE_VALUES",
    "GraphExploration",
    "ThreadMemory",
    "ThreadLink",
    "ToolCallLog",
    "build_vault_buddy_models",
]


class BuddyBase(DeclarativeBase):
    """Dedicated declarative base for Drizzle-owned buddy tables.

    Kept separate from ``SQLModel.metadata`` so ``init_db`` never tries to
    ``CREATE TABLE`` on tables owned by Drizzle migrations.
    """


# Enum value tuples — mirror `packages/db/drizzle/0003_research_buddy_schema.sql`
# and `packages/db/src/schema/research-buddy.ts`.
EXPLORATION_STATUS_VALUES: tuple[str, ...] = ("queued", "running", "done", "error")

# IMPORTANT: `cold_thread_update` is intentionally NOT in this list. Cold-thread
# updates are computed dashboard-side (see design §Dashboard) rather than
# persisted as thread_link rows.
THREAD_LINK_KIND_VALUES: tuple[str, ...] = (
    "topic_overlap",
    "citation_overlap",
    "question_answered",
    "supersedes",
)

GRAPH_EDGE_KIND_VALUES: tuple[str, ...] = (
    "cites",
    "references",
    "similar_embedding",
    "recommended_by_s2",
)

FINDINGS_TRIAGE_VALUES: tuple[str, ...] = ("pending", "saved", "dismissed", "promoted")


# ---------------------------------------------------------------------------
# Public-schema tables
# ---------------------------------------------------------------------------


class GraphExploration(BuddyBase):
    """``public.graph_exploration`` — one row per autonomous dive."""

    __tablename__ = "graph_exploration"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("research_thread.id", ondelete="CASCADE"),
        nullable=False,
    )
    seed = Column(ARRAY(Text), nullable=False)
    budget_papers = Column(Integer, nullable=False, default=60, server_default="60")
    budget_seconds = Column(Integer, nullable=False, default=180, server_default="180")
    status = Column(
        Enum(
            *EXPLORATION_STATUS_VALUES,
            name="exploration_status",
            create_type=False,
        ),
        nullable=False,
        default="queued",
        server_default="queued",
    )
    started_at = Column(DateTime(timezone=True))
    finished_at = Column(DateTime(timezone=True))
    summary_md = Column(Text)
    meta = Column(JSONB)
    errors_json = Column(JSONB)
    error_md = Column(Text)


class ThreadMemory(BuddyBase):
    """``public.thread_memory`` — rolling per-thread state."""

    __tablename__ = "thread_memory"

    thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("research_thread.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rolling_summary_md = Column(Text)
    topic_fingerprint = Column(ARRAY(Text))
    embedding = Column(LargeBinary)  # bytea; NULL when no real embedding exists yet.
    # Identity of the provider/model that produced `embedding`. NULL
    # together with NULL `embedding` — never write a fake model name for a
    # placeholder vector.
    embedding_model = Column(Text)
    turns_since_update = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class ThreadLink(BuddyBase):
    """``public.thread_link`` — discovered synergies between threads.

    Composite PK (from_thread_id, to_thread_id, kind); all NOT NULL.
    """

    __tablename__ = "thread_link"

    from_thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("research_thread.id", ondelete="CASCADE"),
        nullable=False,
    )
    to_thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("research_thread.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind = Column(
        Enum(
            *THREAD_LINK_KIND_VALUES,
            name="thread_link_kind",
            create_type=False,
        ),
        nullable=False,
    )
    score = Column(Float)
    reason_md = Column(Text)
    discovered_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        PrimaryKeyConstraint(
            "from_thread_id",
            "to_thread_id",
            "kind",
            name="thread_link_from_thread_id_to_thread_id_kind_pk",
        ),
    )


class ToolCallLog(BuddyBase):
    """``public.tool_call_log`` — one row per buddy tool invocation."""

    __tablename__ = "tool_call_log"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    thread_id = Column(
        UUID(as_uuid=True),
        ForeignKey("research_thread.id", ondelete="CASCADE"),
        nullable=False,
    )
    runner_session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("runner_session.id", ondelete="SET NULL"),
        nullable=True,
    )
    tool_name = Column(Text, nullable=False)
    args = Column(JSONB)
    result_summary = Column(Text)
    started_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    finished_at = Column(DateTime(timezone=True))
    error = Column(Text)


# ---------------------------------------------------------------------------
# Per-vault factory
# ---------------------------------------------------------------------------

# Cache: avoid re-creating mapped classes (which registers Tables on the
# shared BuddyBase.metadata and would collide) when callers request the same
# schema twice.
_VAULT_MODELS_CACHE: dict[str, dict[str, type[BuddyBase]]] = {}


def _safe_suffix(schema: str) -> str:
    """Turn a schema name into a safe Python class-name suffix.

    ``research_vault`` -> ``ResearchVault``.
    """
    return "".join(part.capitalize() for part in schema.split("_"))


def build_vault_buddy_models(schema: str) -> dict[str, type[BuddyBase]]:
    """Build (or fetch cached) per-vault buddy SQLAlchemy model classes.

    Returned dict keys: ``GraphNode``, ``GraphEdge``, ``StandingInterest``,
    ``FindingsInbox``, ``S2Cache``.

    Registry-collision workaround: class names are suffixed with the schema
    (e.g. ``GraphNode_research_vault``) so each vault gets its own class
    entry in ``BuddyBase.registry``. Subsequent calls for the same schema
    return the cached classes rather than re-registering.
    """
    if schema in _VAULT_MODELS_CACHE:
        return _VAULT_MODELS_CACHE[schema]

    schema_arg = {"schema": schema}

    # ---- GraphNode ----------------------------------------------------
    graph_node_attrs: dict[str, Any] = {
        "__tablename__": "graph_node",
        "__table_args__": schema_arg,
        "source_id": Column(
            Integer,
            ForeignKey(f"{schema}.sources.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        "s2_paper_id": Column(Text, unique=True),
        "openalex_id": Column(Text),
        "doi": Column(Text),
        "influence_score": Column(Float),
        "first_seen_exploration": Column(
            UUID(as_uuid=True),
            ForeignKey("public.graph_exploration.id", ondelete="SET NULL"),
        ),
    }
    GraphNode = type(f"GraphNode_{schema}", (BuddyBase,), graph_node_attrs)
    GraphNode.__name__ = f"GraphNode_{schema}"
    GraphNode.__qualname__ = f"GraphNode_{schema}"
    GraphNode.vault_schema = schema  # type: ignore[attr-defined]

    # ---- GraphEdge ----------------------------------------------------
    graph_edge_attrs: dict[str, Any] = {
        "__tablename__": "graph_edge",
        "__table_args__": (
            PrimaryKeyConstraint(
                "from_source_id",
                "to_source_id",
                "kind",
                name=f"graph_edge_{schema}_from_to_kind_pk",
            ),
            schema_arg,
        ),
        "from_source_id": Column(
            Integer,
            ForeignKey(f"{schema}.sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        "to_source_id": Column(
            Integer,
            ForeignKey(f"{schema}.sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        "kind": Column(
            Enum(
                *GRAPH_EDGE_KIND_VALUES,
                name="graph_edge_kind",
                schema=schema,
                create_type=False,
            ),
            nullable=False,
        ),
        "weight": Column(Float),
        "discovered_in": Column(
            UUID(as_uuid=True),
            ForeignKey("public.graph_exploration.id", ondelete="SET NULL"),
        ),
    }
    GraphEdge = type(f"GraphEdge_{schema}", (BuddyBase,), graph_edge_attrs)
    GraphEdge.__name__ = f"GraphEdge_{schema}"
    GraphEdge.__qualname__ = f"GraphEdge_{schema}"
    GraphEdge.vault_schema = schema  # type: ignore[attr-defined]

    # ---- StandingInterest --------------------------------------------
    # seed_source_ids is ARRAY(Integer), NOT ARRAY(UUID) — sources.id is SERIAL.
    standing_interest_attrs: dict[str, Any] = {
        "__tablename__": "standing_interest",
        "__table_args__": schema_arg,
        "id": Column(
            UUID(as_uuid=True),
            primary_key=True,
            server_default=func.gen_random_uuid(),
        ),
        "thread_id": Column(UUID(as_uuid=True), nullable=True),
        "label": Column(Text, nullable=False),
        "query_terms": Column(
            ARRAY(Text),
            nullable=False,
            default=list,
            server_default="{}",
        ),
        "seed_source_ids": Column(
            ARRAY(Integer),
            nullable=False,
            default=list,
            server_default="{}",
        ),
        "cadence_seconds": Column(
            Integer,
            nullable=False,
            default=7200,
            server_default="7200",
        ),
        "last_run_at": Column(DateTime(timezone=True)),
        "last_cursor": Column(Text),
        "last_error": Column(Text),
        "enabled": Column(
            Boolean,
            nullable=False,
            default=True,
            server_default="true",
        ),
        "auto_disable_suggested": Column(
            Boolean,
            nullable=False,
            default=False,
            server_default="false",
        ),
    }
    StandingInterest = type(
        f"StandingInterest_{schema}", (BuddyBase,), standing_interest_attrs
    )
    StandingInterest.__name__ = f"StandingInterest_{schema}"
    StandingInterest.__qualname__ = f"StandingInterest_{schema}"
    StandingInterest.vault_schema = schema  # type: ignore[attr-defined]

    # ---- FindingsInbox ------------------------------------------------
    findings_inbox_attrs: dict[str, Any] = {
        "__tablename__": "findings_inbox",
        "__table_args__": schema_arg,
        "id": Column(
            UUID(as_uuid=True),
            primary_key=True,
            server_default=func.gen_random_uuid(),
        ),
        "standing_interest_id": Column(
            UUID(as_uuid=True),
            ForeignKey(f"{schema}.standing_interest.id", ondelete="CASCADE"),
        ),
        "source_id": Column(
            Integer,
            ForeignKey(f"{schema}.sources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        "reason_md": Column(Text),
        "score": Column(Float),
        "found_at": Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        ),
        "triage": Column(
            Enum(
                *FINDINGS_TRIAGE_VALUES,
                name="findings_triage",
                schema=schema,
                create_type=False,
            ),
            nullable=False,
            default="pending",
            server_default="pending",
        ),
        "triage_at": Column(DateTime(timezone=True)),
    }
    FindingsInbox = type(f"FindingsInbox_{schema}", (BuddyBase,), findings_inbox_attrs)
    FindingsInbox.__name__ = f"FindingsInbox_{schema}"
    FindingsInbox.__qualname__ = f"FindingsInbox_{schema}"
    FindingsInbox.vault_schema = schema  # type: ignore[attr-defined]

    # ---- S2Cache ------------------------------------------------------
    s2_cache_attrs: dict[str, Any] = {
        "__tablename__": "s2_cache",
        "__table_args__": schema_arg,
        "key": Column(Text, primary_key=True),
        "response_json": Column(JSONB, nullable=False),
        "fetched_at": Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=func.now(),
        ),
        "expires_at": Column(DateTime(timezone=True), nullable=False),
    }
    S2Cache = type(f"S2Cache_{schema}", (BuddyBase,), s2_cache_attrs)
    S2Cache.__name__ = f"S2Cache_{schema}"
    S2Cache.__qualname__ = f"S2Cache_{schema}"
    S2Cache.vault_schema = schema  # type: ignore[attr-defined]

    models: dict[str, type[BuddyBase]] = {
        "GraphNode": GraphNode,
        "GraphEdge": GraphEdge,
        "StandingInterest": StandingInterest,
        "FindingsInbox": FindingsInbox,
        "S2Cache": S2Cache,
    }
    _VAULT_MODELS_CACHE[schema] = models
    return models

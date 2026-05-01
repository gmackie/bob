# ruff: noqa: N806  (ORM classes retrieved from a factory dict are CamelCase locals)
"""Tests for SQLAlchemy mirrors of research-buddy tables.

These models mirror the Drizzle-managed schema at
``packages/db/drizzle/0003_research_buddy_schema.sql``. The Drizzle migration
is the source of truth; these tests guard against drift (especially the
integer-vs-uuid source id distinction introduced in tasks 1.1/1.2).
"""

from sqlalchemy import ARRAY, Boolean, Float, Integer, LargeBinary, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID


def test_graph_exploration_model_shape():
    from research_backend.db_models.buddy import GraphExploration

    assert GraphExploration.__tablename__ == "graph_exploration"
    # Public schema — no schema qualifier.
    assert GraphExploration.__table__.schema is None

    cols = {c.name for c in GraphExploration.__table__.columns}
    expected = {
        "id",
        "thread_id",
        "seed",
        "budget_papers",
        "budget_seconds",
        "status",
        "started_at",
        "finished_at",
        "summary_md",
        "meta",
        "errors_json",
        "error_md",
    }
    assert expected <= cols


def test_thread_memory_model_shape():
    from research_backend.db_models.buddy import ThreadMemory

    assert ThreadMemory.__tablename__ == "thread_memory"
    cols = {c.name for c in ThreadMemory.__table__.columns}
    assert {
        "thread_id",
        "rolling_summary_md",
        "topic_fingerprint",
        "embedding",
        "turns_since_update",
        "updated_at",
    } <= cols

    # thread_id is PK
    pk_cols = {c.name for c in ThreadMemory.__table__.primary_key.columns}
    assert pk_cols == {"thread_id"}

    # embedding is LargeBinary (bytea)
    embedding_col = ThreadMemory.__table__.columns["embedding"]
    assert isinstance(embedding_col.type, LargeBinary)


def test_thread_link_composite_pk_all_not_null():
    from research_backend.db_models.buddy import ThreadLink

    assert ThreadLink.__tablename__ == "thread_link"
    pk_cols = {c.name for c in ThreadLink.__table__.primary_key.columns}
    assert pk_cols == {"from_thread_id", "to_thread_id", "kind"}

    # All three PK columns must be NOT NULL.
    for col_name in ("from_thread_id", "to_thread_id", "kind"):
        col = ThreadLink.__table__.columns[col_name]
        assert col.nullable is False, f"{col_name} must be NOT NULL"


def test_thread_link_kind_enum_values():
    """Regression guard: cold_thread_update was removed from the enum.

    Cold-thread updates are computed dashboard-side (design §Dashboard),
    not persisted. The enum has exactly 4 values.
    """
    from research_backend.db_models.buddy import THREAD_LINK_KIND_VALUES

    assert set(THREAD_LINK_KIND_VALUES) == {
        "topic_overlap",
        "citation_overlap",
        "question_answered",
        "supersedes",
    }
    assert "cold_thread_update" not in THREAD_LINK_KIND_VALUES


def test_tool_call_log_model_shape():
    from research_backend.db_models.buddy import ToolCallLog

    assert ToolCallLog.__tablename__ == "tool_call_log"
    cols = {c.name for c in ToolCallLog.__table__.columns}
    assert {
        "id",
        "thread_id",
        "runner_session_id",
        "tool_name",
        "args",
        "result_summary",
        "started_at",
        "finished_at",
        "error",
    } <= cols

    # tool_name and thread_id are NOT NULL per 0003 migration.
    assert ToolCallLog.__table__.columns["tool_name"].nullable is False
    assert ToolCallLog.__table__.columns["thread_id"].nullable is False
    # runner_session_id is nullable (ON DELETE SET NULL).
    assert ToolCallLog.__table__.columns["runner_session_id"].nullable is True


def test_build_vault_buddy_models_returns_expected_keys():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    assert set(models.keys()) == {
        "GraphNode",
        "GraphEdge",
        "StandingInterest",
        "FindingsInbox",
        "S2Cache",
    }


def test_build_vault_buddy_models_applies_schema():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    for cls in models.values():
        assert cls.__table__.schema == "research_vault"


def test_build_vault_buddy_models_idempotent_across_schemas():
    """Calling the factory twice for different schemas must not raise
    InvalidRequestError due to class / table registry collisions."""
    from research_backend.db_models.buddy import build_vault_buddy_models

    research = build_vault_buddy_models("research_vault")
    personal = build_vault_buddy_models("personal_vault")

    assert research["GraphNode"].__table__.schema == "research_vault"
    assert personal["GraphNode"].__table__.schema == "personal_vault"
    # Classes are distinct objects.
    assert research["GraphNode"] is not personal["GraphNode"]


def test_build_vault_buddy_models_called_twice_same_schema_is_safe():
    """Re-calling with the same schema returns cached classes; no registry
    collision even if called multiple times in the same process."""
    from research_backend.db_models.buddy import build_vault_buddy_models

    a = build_vault_buddy_models("research_vault")
    b = build_vault_buddy_models("research_vault")
    assert a["GraphNode"] is b["GraphNode"]


def test_graph_node_source_id_is_integer_not_uuid():
    """Regression guard: sources.id is SERIAL (Integer) per vault-taxonomy.
    All source FKs must be Integer, not UUID."""
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    GraphNode = models["GraphNode"]
    source_id_col = GraphNode.__table__.columns["source_id"]
    assert isinstance(source_id_col.type, Integer)
    # And source_id is PK.
    pk_cols = {c.name for c in GraphNode.__table__.primary_key.columns}
    assert pk_cols == {"source_id"}


def test_graph_edge_from_to_source_id_are_integer():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    GraphEdge = models["GraphEdge"]
    for col_name in ("from_source_id", "to_source_id"):
        col = GraphEdge.__table__.columns[col_name]
        assert isinstance(col.type, Integer), f"{col_name} must be Integer"

    pk_cols = {c.name for c in GraphEdge.__table__.primary_key.columns}
    assert pk_cols == {"from_source_id", "to_source_id", "kind"}


def test_standing_interest_seed_source_ids_is_integer_array_not_uuid():
    """CRITICAL regression guard: seed_source_ids is integer[], NOT uuid[].

    The original plan had uuid[] but the actual schema (task 1.2) uses
    integer[] because sources.id is SERIAL.
    """
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    StandingInterest = models["StandingInterest"]
    col = StandingInterest.__table__.columns["seed_source_ids"]
    assert isinstance(col.type, ARRAY)
    # item_type of the ARRAY should be Integer, not UUID.
    assert isinstance(col.type.item_type, Integer)
    assert not isinstance(col.type.item_type, UUID)


def test_standing_interest_query_terms_is_text_array():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    StandingInterest = models["StandingInterest"]
    col = StandingInterest.__table__.columns["query_terms"]
    assert isinstance(col.type, ARRAY)
    assert isinstance(col.type.item_type, Text)


def test_standing_interest_has_all_expected_columns():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    StandingInterest = models["StandingInterest"]
    cols = {c.name for c in StandingInterest.__table__.columns}
    assert {
        "id",
        "thread_id",
        "label",
        "query_terms",
        "seed_source_ids",
        "cadence_seconds",
        "last_run_at",
        "last_cursor",
        "last_error",
        "enabled",
        "auto_disable_suggested",
    } <= cols

    # enabled and auto_disable_suggested must be NOT NULL.
    assert StandingInterest.__table__.columns["enabled"].nullable is False
    assert isinstance(StandingInterest.__table__.columns["enabled"].type, Boolean)
    assert StandingInterest.__table__.columns["auto_disable_suggested"].nullable is False


def test_findings_inbox_source_id_is_integer():
    """Regression guard: source_id in findings_inbox is integer, not uuid."""
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    FindingsInbox = models["FindingsInbox"]
    col = FindingsInbox.__table__.columns["source_id"]
    assert isinstance(col.type, Integer)
    assert col.nullable is False


def test_findings_inbox_has_triage_with_default_pending():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    FindingsInbox = models["FindingsInbox"]
    cols = {c.name for c in FindingsInbox.__table__.columns}
    assert {"triage", "reason_md", "standing_interest_id", "score", "found_at", "triage_at"} <= cols
    assert FindingsInbox.__table__.columns["triage"].nullable is False


def test_s2_cache_model_shape():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    S2Cache = models["S2Cache"]
    cols = {c.name for c in S2Cache.__table__.columns}
    assert {"key", "response_json", "fetched_at", "expires_at"} <= cols
    # key is PK
    pk_cols = {c.name for c in S2Cache.__table__.primary_key.columns}
    assert pk_cols == {"key"}
    # response_json is JSONB and NOT NULL.
    assert isinstance(S2Cache.__table__.columns["response_json"].type, JSONB)
    assert S2Cache.__table__.columns["response_json"].nullable is False
    assert S2Cache.__table__.columns["expires_at"].nullable is False


def test_graph_node_first_seen_exploration_fks_public_graph_exploration():
    """Cross-schema FK: graph_node.first_seen_exploration -> public.graph_exploration.id
    with ON DELETE SET NULL."""
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    GraphNode = models["GraphNode"]
    col = GraphNode.__table__.columns["first_seen_exploration"]
    # Type is UUID (references public.graph_exploration.id which is uuid).
    assert isinstance(col.type, UUID)
    # Must have FK to public.graph_exploration.id.
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    target = fks[0].target_fullname
    assert target == "public.graph_exploration.id", f"got {target}"
    assert fks[0].ondelete == "SET NULL"


def test_graph_edge_discovered_in_fks_public_graph_exploration():
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    GraphEdge = models["GraphEdge"]
    col = GraphEdge.__table__.columns["discovered_in"]
    assert isinstance(col.type, UUID)
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].target_fullname == "public.graph_exploration.id"
    assert fks[0].ondelete == "SET NULL"


def test_public_classes_are_importable_from_package():
    """Exposed via db_models package __init__."""
    from research_backend.db_models import (
        GraphExploration,
        ThreadLink,
        ThreadMemory,
        ToolCallLog,
        build_vault_buddy_models,
    )

    assert GraphExploration.__tablename__ == "graph_exploration"
    assert ThreadMemory.__tablename__ == "thread_memory"
    assert ThreadLink.__tablename__ == "thread_link"
    assert ToolCallLog.__tablename__ == "tool_call_log"
    assert callable(build_vault_buddy_models)


def test_array_types_have_expected_float_and_text_columns():
    """Quick type sanity — influence_score and score are Float."""
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    assert isinstance(models["GraphNode"].__table__.columns["influence_score"].type, Float)
    assert isinstance(models["GraphEdge"].__table__.columns["weight"].type, Float)
    assert isinstance(models["FindingsInbox"].__table__.columns["score"].type, Float)


def test_per_vault_enum_names_match_postgres():
    """Enum `name` should be bare (no vault suffix) — schema kwarg disambiguates."""
    from research_backend.db_models.buddy import build_vault_buddy_models

    models = build_vault_buddy_models("research_vault")
    edge_col = models["GraphEdge"].__table__.columns["kind"]
    assert edge_col.type.name == "graph_edge_kind", \
        f"Expected bare 'graph_edge_kind', got {edge_col.type.name!r}"
    assert edge_col.type.schema == "research_vault"

    triage_col = models["FindingsInbox"].__table__.columns["triage"]
    assert triage_col.type.name == "findings_triage"
    assert triage_col.type.schema == "research_vault"

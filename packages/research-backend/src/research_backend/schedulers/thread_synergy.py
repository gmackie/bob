"""Thread synergy tick — nightly maintenance for ``thread_memory`` and
cross-thread link discovery.

Design reference: ``docs/plans/2026-04-19-academic-research-buddy-design.md``
section 5 (Job B: ``thread_synergy_tick``).

Responsibilities
----------------
1. Refresh ``thread_memory.rolling_summary_md`` + ``topic_fingerprint`` +
   ``embedding`` for each thread whose memory is stale
   (``updated_at < now() - 24h``) or whose turn counter exceeded the
   rebuild threshold (``turns_since_update > 10``).
2. Upsert ``thread_link`` rows for each pair of refreshed threads when
   their fingerprint-embedding cosine similarity is ≥ 0.80
   (``kind = 'topic_overlap'``).
3. Upsert ``thread_link`` rows for each pair sharing ≥ 3 paper
   ``source_id``s via ``graph_node`` (``kind = 'citation_overlap'``).
4. Flag a ``standing_interest`` whose last 20 ``findings_inbox`` triage
   actions are ≥ 80% ``dismissed`` — the dashboard renders this as
   "looks dead".

Explicitly NOT persisted
------------------------
Cold-thread updates. The dashboard computes them on the fly
(see design §Dashboard). The ``thread_link_kind`` pg enum no longer
contains ``cold_thread_update``; writing such a row would fail at the
DB level, so the tick simply never tries.

Dependencies
------------
All LLM + embedding calls are *injected* so tests (and eventually
production) can swap providers. The default stubs raise a clear error
rather than silently producing garbage — callers wanting a real run
must wire in ``llm_summarize`` and ``embed_text`` explicitly.

Embedding format
----------------
Stored as ``bytea`` (``LargeBinary``). We use ``numpy.float32``
serialization: ``np.asarray(vec, dtype=np.float32).tobytes()`` on write,
``np.frombuffer(buf, dtype=np.float32)`` on read. Empty vectors (``None``
or zero-length) are treated as "no fingerprint yet".
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any

import numpy as np
from sqlalchemy import text

logger = logging.getLogger(__name__)

__all__ = [
    "tick",
    "SynergyResult",
    "DEFAULT_STALE_HOURS",
    "DEFAULT_TURN_THRESHOLD",
    "DEFAULT_SUMMARY_CHAR_CAP",
    "DEFAULT_TOPIC_COS_THRESHOLD",
    "DEFAULT_CITATION_SHARED_THRESHOLD",
    "DEFAULT_ENTITY_SHARED_THRESHOLD",
    "DEFAULT_DEAD_WINDOW",
    "DEFAULT_DEAD_DISMISS_RATIO",
]


# ---------------------------------------------------------------------------
# Tunable thresholds
# ---------------------------------------------------------------------------

DEFAULT_STALE_HOURS = 24
DEFAULT_TURN_THRESHOLD = 10
# ~1200 tokens at ~5 chars/token. If the new summary exceeds this, we
# re-summarize with the compaction prompt.
DEFAULT_SUMMARY_CHAR_CAP = 6000
DEFAULT_TOPIC_COS_THRESHOLD = 0.80
DEFAULT_CITATION_SHARED_THRESHOLD = 3
DEFAULT_ENTITY_SHARED_THRESHOLD = 3
DEFAULT_DEAD_WINDOW = 20
DEFAULT_DEAD_DISMISS_RATIO = 0.80


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class SynergyResult:
    summaries_refreshed: int = 0
    notes_backfilled: int = 0
    topic_edges: int = 0
    citation_edges: int = 0
    entity_edges: int = 0
    dead_interests_flagged: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "summaries_refreshed": self.summaries_refreshed,
            "notes_backfilled": self.notes_backfilled,
            "topic_edges": self.topic_edges,
            "citation_edges": self.citation_edges,
            "entity_edges": self.entity_edges,
            "dead_interests_flagged": self.dead_interests_flagged,
        }


# ---------------------------------------------------------------------------
# LLM / embedding defaults (explicit failure rather than silent fallback)
# ---------------------------------------------------------------------------


def _default_llm_summarize(*, prior_summary: str, turns: list[str], compact: bool) -> str:
    """Default LLM summarizer — raises so tests must inject a stub."""
    raise RuntimeError(
        "thread_synergy.tick called without llm_summarize callable. "
        "Inject one (or set up the provider stack) before running in prod."
    )


def _default_embed_text(text_in: str) -> list[float] | None:
    """Default embedder — raises so tests must inject a stub."""
    raise RuntimeError(
        "thread_synergy.tick called without embed_text callable. "
        "Inject one (or wire s2/embed endpoint) before running in prod."
    )


# ---------------------------------------------------------------------------
# Vector helpers
# ---------------------------------------------------------------------------


def _encode_vec(vec: list[float]) -> bytes:
    return np.asarray(list(vec), dtype=np.float32).tobytes()


def _decode_vec(buf: bytes | memoryview | None) -> np.ndarray | None:
    if buf is None:
        return None
    if isinstance(buf, memoryview):
        buf = bytes(buf)
    if len(buf) == 0:
        return None
    return np.frombuffer(buf, dtype=np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        return 0.0
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ---------------------------------------------------------------------------
# Sub-steps (pure helpers, each owning one session hop)
# ---------------------------------------------------------------------------


def _select_threads_to_refresh(
    session: Any,
    *,
    stale_hours: int,
    turn_threshold: int,
    limit: int,
) -> list[Any]:
    """Return thread_memory rows that need a rolling_summary rebuild."""
    rows = session.execute(
        text(
            """
            SELECT thread_id,
                   rolling_summary_md,
                   turns_since_update,
                   updated_at
              FROM thread_memory
             WHERE updated_at < now() - (:stale_hours || ' hours')::interval
                OR turns_since_update > :turn_threshold
             ORDER BY updated_at ASC NULLS FIRST
             LIMIT :lim
            """
        ),
        {
            "stale_hours": str(stale_hours),
            "turn_threshold": turn_threshold,
            "lim": limit,
        },
    ).all()
    return list(rows)


def _load_recent_turns(session: Any, thread_id: Any, n: int = 10) -> list[str]:
    """Best-effort pull of recent thread turns.

    The thread-message table lives in the OODA app schema and its exact
    layout isn't frozen yet (see implementation plan). We read whatever
    is available and tolerate absence — when the table/column is missing
    we return an empty list and let the summarizer work with just the
    prior summary.
    """
    try:
        rows = session.execute(
            text(
                """
                SELECT content
                  FROM thread_message
                 WHERE thread_id = :tid
                 ORDER BY created_at DESC
                 LIMIT :n
                """
            ),
            {"tid": thread_id, "n": n},
        ).all()
    except Exception:
        # Table absent in this environment — caller can still produce a
        # fresh summary from prior_summary alone.
        return []
    return [str(getattr(r, "content", "")) for r in rows if getattr(r, "content", None)]


def _refresh_thread_memory(
    session: Any,
    row: Any,
    *,
    llm_summarize: Callable[..., str],
    embed_text: Callable[[str], list[float] | None],
    summary_char_cap: int,
    embedding_model: str | None = None,
) -> bool:
    """Rebuild one thread_memory row. Commits on success, rolls back on failure.

    ``embed_text`` may return ``None`` when no embedding provider is wired
    (CLI placeholder path). In that case we write ``embedding = NULL`` and
    leave ``embedding_model = NULL`` so a future "re-embed placeholders"
    sweep can find these rows. We deliberately do NOT store a zero-vector:
    cosine against zero-vectors returns 0.0 and silently pretends threads
    are uncorrelated, which would poison synergy results for months once a
    real embedder lands.
    """
    thread_id = row.thread_id
    prior_summary = row.rolling_summary_md or ""

    try:
        turns = _load_recent_turns(session, thread_id)
        new_summary = llm_summarize(
            prior_summary=prior_summary,
            turns=turns,
            compact=False,
        )
        if new_summary is None:
            new_summary = ""

        # Compaction pass when we overflow the token cap.
        if len(new_summary) > summary_char_cap:
            new_summary = llm_summarize(
                prior_summary=new_summary,
                turns=[],
                compact=True,
            )
            if new_summary is None:
                new_summary = ""

        vec = embed_text(new_summary)
        if vec is None:
            # No real embedder wired — store NULL, not a zero-vec.
            encoded: bytes | None = None
            model_label: str | None = None
        else:
            encoded = _encode_vec(vec)
            model_label = embedding_model

        session.execute(
            text(
                """
                UPDATE thread_memory
                   SET rolling_summary_md = :summary,
                       embedding = :emb,
                       embedding_model = :model,
                       turns_since_update = 0,
                       updated_at = now()
                 WHERE thread_id = :tid
                """
            ),
            {
                "summary": new_summary,
                "emb": encoded,
                "model": model_label,
                "tid": thread_id,
            },
        )
        session.commit()
        return True
    except Exception:
        logger.exception("thread_synergy: failed to refresh thread %s", thread_id)
        try:
            session.rollback()
        except Exception:
            pass
        return False


def _load_refreshed_fingerprints(
    session: Any,
    thread_ids: list[Any],
) -> dict[Any, np.ndarray]:
    if not thread_ids:
        return {}
    rows = session.execute(
        text(
            """
            SELECT thread_id, embedding
              FROM thread_memory
             WHERE thread_id = ANY(:ids)
            """
        ),
        {"ids": list(thread_ids)},
    ).all()
    out: dict[Any, np.ndarray] = {}
    for r in rows:
        vec = _decode_vec(r.embedding)
        if vec is not None and vec.size > 0:
            out[r.thread_id] = vec
    return out


def _load_thread_source_ids(
    session: Any,
    thread_ids: list[Any],
    *,
    schema: str,
) -> dict[Any, set[int]]:
    """For each thread id, return the set of graph_node.source_id
    reachable via graph_exploration rows owned by that thread."""
    if not thread_ids:
        return {}
    try:
        rows = session.execute(
            text(
                f"""
                SELECT ge.thread_id AS thread_id, gn.source_id AS source_id
                  FROM public.graph_exploration AS ge
                  JOIN {schema}.graph_node AS gn
                    ON gn.first_seen_exploration = ge.id
                 WHERE ge.thread_id = ANY(:ids)
                """  # noqa: S608 — schema is caller-validated
            ),
            {"ids": list(thread_ids)},
        ).all()
    except Exception:
        logger.exception("thread_synergy: failed to load graph_node sources")
        return {tid: set() for tid in thread_ids}
    out: dict[Any, set[int]] = {tid: set() for tid in thread_ids}
    for r in rows:
        tid = r.thread_id
        sid = r.source_id
        if tid in out and sid is not None:
            out[tid].add(int(sid))
    return out


def _upsert_thread_link(
    session: Any,
    *,
    a: Any,
    b: Any,
    kind: str,
    score: float,
    reason_md: str,
) -> None:
    # Safety assertion: this module never writes cold_thread_update.
    if kind == "cold_thread_update":
        raise ValueError(
            "thread_synergy never persists cold_thread_update; "
            "dashboard computes it on the fly."
        )
    if a == b:
        return
    lo, hi = (a, b) if str(a) <= str(b) else (b, a)
    session.execute(
        text(
            """
            INSERT INTO thread_link
                (from_thread_id, to_thread_id, kind, score, reason_md)
            VALUES (:a, :b, :kind, :score, :reason)
            ON CONFLICT (from_thread_id, to_thread_id, kind)
            DO UPDATE SET score = EXCLUDED.score,
                          reason_md = EXCLUDED.reason_md,
                          discovered_at = now()
            """
        ),
        {
            "a": lo,
            "b": hi,
            "kind": kind,
            "score": score,
            "reason": reason_md,
        },
    )


def _flag_dead_interests(
    session: Any,
    *,
    schema: str,
    window: int,
    dismiss_ratio: float,
) -> int:
    """Set auto_disable_suggested=true on standing_interests with high
    dismissal rate in their last ``window`` findings_inbox rows.

    Uses the existing ``auto_disable_suggested`` column (design §Dashboard
    — "flag auto_disable_suggested"). We do NOT disable the interest; the
    human sees the flag and decides.
    """
    try:
        # Compute per-interest dismissal fraction over its newest `window`
        # findings. LATERAL lets us limit to top-N per group cleanly.
        result = session.execute(
            text(
                f"""
                WITH recent AS (
                    SELECT si.id AS interest_id,
                           f.triage AS triage
                      FROM {schema}.standing_interest AS si
                      JOIN LATERAL (
                           SELECT triage
                             FROM {schema}.findings_inbox
                            WHERE standing_interest_id = si.id
                            ORDER BY found_at DESC
                            LIMIT :window
                      ) AS f ON TRUE
                ),
                rolled AS (
                    SELECT interest_id,
                           COUNT(*) AS total,
                           SUM(CASE WHEN triage = 'dismissed' THEN 1 ELSE 0 END) AS dismissed
                      FROM recent
                     GROUP BY interest_id
                )
                UPDATE {schema}.standing_interest AS si
                   SET auto_disable_suggested = TRUE
                  FROM rolled
                 WHERE rolled.interest_id = si.id
                   AND rolled.total >= :window
                   AND (rolled.dismissed::float / rolled.total::float) >= :ratio
                   AND si.auto_disable_suggested = FALSE
                """  # noqa: S608 — schema is caller-validated
            ),
            {"window": window, "ratio": dismiss_ratio},
        )
        session.commit()
        return int(result.rowcount or 0)
    except Exception:
        logger.exception("thread_synergy: dead-interest flag pass failed")
        try:
            session.rollback()
        except Exception:
            pass
        return 0


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


_VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})


def tick(
    session_factory: Callable[[], AbstractContextManager[Any]],
    *,
    thread_limit: int = 50,
    schema: str = "research_vault",
    llm_summarize: Callable[..., str] | None = None,
    embed_text: Callable[[str], list[float] | None] | None = None,
    embedding_model: str | None = None,
    stale_hours: int = DEFAULT_STALE_HOURS,
    turn_threshold: int = DEFAULT_TURN_THRESHOLD,
    summary_char_cap: int = DEFAULT_SUMMARY_CHAR_CAP,
    topic_cos_threshold: float = DEFAULT_TOPIC_COS_THRESHOLD,
    citation_shared_threshold: int = DEFAULT_CITATION_SHARED_THRESHOLD,
    entity_shared_threshold: int = DEFAULT_ENTITY_SHARED_THRESHOLD,
    dead_window: int = DEFAULT_DEAD_WINDOW,
    dead_dismiss_ratio: float = DEFAULT_DEAD_DISMISS_RATIO,
) -> dict[str, int]:
    """Run one synergy tick synchronously.

    Parameters
    ----------
    session_factory:
        Context-manager-returning callable. Each call yields a fresh
        session. The tick commits per-thread (not whole-tick) so a
        single bad thread can't poison the whole run.
    thread_limit:
        Hard cap on threads refreshed per tick (design §Cost controls).
    schema:
        Vault schema for ``graph_node`` / ``standing_interest`` /
        ``findings_inbox`` reads. Must be in the allowlist to prevent
        SQL-injection via f-string schema interpolation.
    llm_summarize / embed_text:
        Injected dependencies. When omitted the module raises on first
        use — refusing to run is safer than silently no-op'ing.

    Returns
    -------
    dict
        ``{summaries_refreshed, notes_backfilled, topic_edges,
        citation_edges, entity_edges, dead_interests_flagged}``.
    """
    if schema not in _VALID_SCHEMAS:
        raise ValueError(f"Invalid vault schema: {schema!r}")

    llm_summarize = llm_summarize or _default_llm_summarize
    embed_text = embed_text or _default_embed_text

    result = SynergyResult()

    # Step 1: select stale/turn-triggered threads.
    with session_factory() as session:
        stale_rows = _select_threads_to_refresh(
            session,
            stale_hours=stale_hours,
            turn_threshold=turn_threshold,
            limit=thread_limit,
        )

    refreshed_ids: list[Any] = []
    for row in stale_rows:
        with session_factory() as session:
            if _refresh_thread_memory(
                session,
                row,
                llm_summarize=llm_summarize,
                embed_text=embed_text,
                summary_char_cap=summary_char_cap,
                embedding_model=embedding_model,
            ):
                result.summaries_refreshed += 1
                refreshed_ids.append(row.thread_id)

    # Step 2+3: pairwise topic + citation overlaps over refreshed threads.
    if refreshed_ids:
        with session_factory() as session:
            fingerprints = _load_refreshed_fingerprints(session, refreshed_ids)
            sources_by_thread = _load_thread_source_ids(
                session, refreshed_ids, schema=schema
            )

            ids = sorted(fingerprints.keys(), key=str)
            for i, a in enumerate(ids):
                for b in ids[i + 1:]:
                    vec_a = fingerprints[a]
                    vec_b = fingerprints[b]
                    try:
                        cos = _cosine(vec_a, vec_b)
                    except Exception:
                        cos = 0.0
                    if cos >= topic_cos_threshold:
                        try:
                            _upsert_thread_link(
                                session,
                                a=a, b=b,
                                kind="topic_overlap",
                                score=cos,
                                reason_md=f"Topic overlap (cos={cos:.2f})",
                            )
                            result.topic_edges += 1
                        except Exception:
                            logger.exception(
                                "thread_synergy: topic_overlap upsert failed (%s, %s)",
                                a, b,
                            )

            # Citation overlap — separate loop so a topic-edge failure
            # doesn't cascade into skipping citation detection.
            ids_with_sources = [tid for tid in ids if sources_by_thread.get(tid)]
            for i, a in enumerate(ids_with_sources):
                for b in ids_with_sources[i + 1:]:
                    shared = sources_by_thread[a] & sources_by_thread[b]
                    if len(shared) >= citation_shared_threshold:
                        max_count = max(
                            len(sources_by_thread[a]),
                            len(sources_by_thread[b]),
                        )
                        score = len(shared) / max_count if max_count else 0.0
                        try:
                            _upsert_thread_link(
                                session,
                                a=a, b=b,
                                kind="citation_overlap",
                                score=score,
                                reason_md=f"Shared {len(shared)} papers",
                            )
                            result.citation_edges += 1
                        except Exception:
                            logger.exception(
                                "thread_synergy: citation_overlap upsert failed (%s, %s)",
                                a, b,
                            )
            session.commit()

    # Step 3b: Backfill unextracted notes -----------------------------------
    notes_backfilled = 0
    try:
        with session_factory() as session:
            unextracted = session.execute(
                text(
                    "SELECT ni.id, ni.thread_id, ni.note_id, ni.title, ni.kind, "
                    "ni.content_hash "
                    "FROM note_index ni "
                    "WHERE ni.extracted_at IS NULL "
                    "LIMIT :lim"
                ),
                {"lim": thread_limit},
            ).all()

        for row in unextracted:
            nid = str(row[0]) if hasattr(row, "__getitem__") else str(row.id)
            tid = str(row[1]) if hasattr(row, "__getitem__") else str(row.thread_id)
            note_id = row[2] if hasattr(row, "__getitem__") else row.note_id
            title = row[3] if hasattr(row, "__getitem__") else row.title
            kind = row[4] if hasattr(row, "__getitem__") else row.kind
            logger.info("Backfilling note %s in thread %s", note_id, tid)
            try:
                # Entity extraction via LLM using the extraction prompt
                from research_backend.routes.extraction import (
                    EXTRACTION_SYSTEM_PROMPT,
                    _parse_entities,
                )

                prompt = f"Title: {title}\nKind: {kind}"
                raw_output = llm_summarize(
                    prior_summary="",
                    turns=[f"{EXTRACTION_SYSTEM_PROMPT}\n\n{prompt}"],
                    compact=False,
                )
                entities = _parse_entities(raw_output)

                with session_factory() as session:
                    session.execute(
                        text("DELETE FROM note_entity WHERE note_index_id = :nid"),
                        {"nid": nid},
                    )
                    for e in entities:
                        session.execute(
                            text(
                                "INSERT INTO note_entity "
                                "(id, note_index_id, thread_id, name, entity_type, salience) "
                                "VALUES (gen_random_uuid(), :nid, :tid, :name, :etype, :sal)"
                            ),
                            {
                                "nid": nid,
                                "tid": tid,
                                "name": e["name"],
                                "etype": e["type"],
                                "sal": e["salience"],
                            },
                        )
                    session.commit()

                # Embed title via the injected embedder
                vec = embed_text(title)
                if vec is not None:
                    encoded = _encode_vec(vec)
                    with session_factory() as session:
                        session.execute(
                            text(
                                "UPDATE note_index SET embedding = :emb, "
                                "embedding_model = :model WHERE id = :id"
                            ),
                            {"emb": encoded, "model": embedding_model, "id": nid},
                        )
                        session.commit()

                with session_factory() as session:
                    session.execute(
                        text(
                            "UPDATE note_index SET extracted_at = now() WHERE id = :id"
                        ),
                        {"id": nid},
                    )
                    session.commit()
                notes_backfilled += 1
            except Exception:
                logger.exception("Backfill failed for note %s", note_id)
    except Exception:
        logger.exception("Note backfill step failed")
    result.notes_backfilled = notes_backfilled

    # Step 4: Entity overlap links -----------------------------------------
    entity_edges = 0
    try:
        with session_factory() as session:
            rows = session.execute(
                text("SELECT thread_id, name FROM note_entity")
            ).all()

        thread_entities: dict[str, set[str]] = {}
        for row in rows:
            tid = str(row[0]) if hasattr(row, "__getitem__") else str(row.thread_id)
            name = row[1] if hasattr(row, "__getitem__") else row.name
            thread_entities.setdefault(tid, set()).add(name)

        thread_ids = sorted(thread_entities.keys())
        for i in range(len(thread_ids)):
            for j in range(i + 1, len(thread_ids)):
                a, b = thread_ids[i], thread_ids[j]
                shared = thread_entities[a] & thread_entities[b]
                if len(shared) < entity_shared_threshold:
                    continue
                max_count = max(len(thread_entities[a]), len(thread_entities[b]))
                score = len(shared) / max_count if max_count > 0 else 0.0
                reason = (
                    f"Shared entities ({len(shared)}): "
                    + ", ".join(sorted(shared)[:10])
                )
                with session_factory() as session:
                    _upsert_thread_link(
                        session,
                        a=a,
                        b=b,
                        kind="entity_overlap",
                        score=score,
                        reason_md=reason,
                    )
                    session.commit()
                entity_edges += 1
    except Exception:
        logger.exception("Entity overlap link discovery failed")
    result.entity_edges = entity_edges

    # Step 5: dead-interest flagging (independent of thread refresh).
    with session_factory() as session:
        result.dead_interests_flagged = _flag_dead_interests(
            session,
            schema=schema,
            window=dead_window,
            dismiss_ratio=dead_dismiss_ratio,
        )

    return result.as_dict()

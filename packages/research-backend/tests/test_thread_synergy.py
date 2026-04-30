"""Tests for :mod:`research_backend.schedulers.thread_synergy`.

All unit tests — no real DB, no real LLM, no real embedding endpoint.
The session is a scripted fake and the LLM / embed callables are
deterministic stubs so the full tick runs offline in milliseconds.

Regression guards worth calling out:

* ``test_no_cold_thread_update_row_written`` — the enum
  ``thread_link_kind`` no longer has ``cold_thread_update``; the tick
  must never attempt to insert that kind.
* ``test_memory_compaction`` — an over-cap summary round-trips through
  a second (compaction) LLM pass.
"""

from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from research_backend.schedulers import thread_synergy
from research_backend.schedulers.thread_synergy import tick

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "synergy_threads.json"


# ---------------------------------------------------------------------------
# Session fakes
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(
        self,
        rows: list[Any] | None = None,
        rowcount: int = 0,
    ) -> None:
        self._rows = rows or []
        self.rowcount = rowcount

    def first(self) -> Any:
        return self._rows[0] if self._rows else None

    def all(self) -> list[Any]:
        return list(self._rows)


class _Row:
    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeSession:
    """Session that routes execute() calls by SQL fragment substring.

    Each call is recorded on ``.calls`` as ``(sql_text, params)`` so
    tests can assert on exactly what was sent to Postgres.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.responses: list[tuple[str, _FakeResult]] = []
        self.commits = 0
        self.rollbacks = 0
        # Mutable store of thread_memory rows for UPDATE side-effects.
        self.memory_store: dict[Any, dict[str, Any]] = {}

    def add_response(self, fragment: str, result: _FakeResult) -> None:
        self.responses.append((fragment.lower(), result))

    def execute(
        self,
        stmt: Any,
        params: dict[str, Any] | None = None,
    ) -> _FakeResult:
        sql = str(stmt)
        self.calls.append((sql, dict(params or {})))
        lower = sql.lower()

        # Side-effect: UPDATE thread_memory writes back to memory_store
        # so a subsequent SELECT can see the new embedding.
        if "update thread_memory" in lower and "set rolling_summary_md" in lower:
            tid = (params or {}).get("tid")
            if tid is not None:
                self.memory_store.setdefault(tid, {}).update(
                    {
                        "rolling_summary_md": (params or {}).get("summary"),
                        "embedding": (params or {}).get("emb"),
                    }
                )
            return _FakeResult(rowcount=1)

        for fragment, result in self.responses:
            if fragment in lower:
                return result
        return _FakeResult()

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    # --- helpers for assertions -------------------------------------------

    def insert_calls_for(self, table: str) -> list[tuple[str, dict[str, Any]]]:
        table = table.lower()
        return [
            (s, p)
            for s, p in self.calls
            if f"insert into {table}" in s.lower()
        ]

    def any_call_contains(self, fragment: str) -> bool:
        lf = fragment.lower()
        return any(lf in s.lower() for s in (c[0] for c in self.calls))


class SessionHarness:
    """Hand out fresh FakeSessions and remember every one produced.

    All sessions share ``memory_store`` so UPDATE from one session hop
    is visible to SELECTs in the next hop (mimicking a committed tx).
    """

    def __init__(self) -> None:
        self.sessions: list[FakeSession] = []
        self.memory_store: dict[Any, dict[str, Any]] = {}
        self.pre_hooks: list[Any] = []

    def add_pre_hook(self, hook) -> None:  # type: ignore[no-untyped-def]
        self.pre_hooks.append(hook)

    @contextmanager
    def __call__(self):  # type: ignore[no-untyped-def]
        s = FakeSession()
        s.memory_store = self.memory_store  # shared
        for hook in self.pre_hooks:
            hook(s)
        self.sessions.append(s)
        try:
            yield s
        finally:
            pass

    def all_calls(self) -> list[tuple[str, dict[str, Any]]]:
        out: list[tuple[str, dict[str, Any]]] = []
        for s in self.sessions:
            out.extend(s.calls)
        return out


# ---------------------------------------------------------------------------
# Stub LLM + embedder
# ---------------------------------------------------------------------------


def make_stub_llm(
    *,
    output: str = "fresh summary",
    compact_output: str = "compacted summary",
    overflow_char_cap: int | None = None,
    track: list[dict[str, Any]] | None = None,
):
    """Return a deterministic llm_summarize stub.

    If ``overflow_char_cap`` is set, the first (non-compact) call returns
    a string longer than that cap so the tick triggers its compaction
    pass on the next call (compact=True → returns ``compact_output``).
    """
    track = track if track is not None else []

    def _llm(*, prior_summary: str, turns: list[str], compact: bool) -> str:
        track.append({"compact": compact, "turns": list(turns)})
        if compact:
            return compact_output
        if overflow_char_cap is not None:
            return "x" * (overflow_char_cap + 10)
        return output

    _llm.track = track  # type: ignore[attr-defined]
    return _llm


def make_stub_embedder(fixed_vectors: dict[str, list[float]] | None = None):
    """Embed by deriving a fixed vector from the summary text.

    ``fixed_vectors`` maps substrings → vectors; the first substring
    found in the text wins. Otherwise we fall back to a stable hash-based
    pseudo-vector so two identical summaries get identical embeddings.
    """
    fixed_vectors = fixed_vectors or {}

    def _embed(text_in: str) -> list[float]:
        for key, vec in fixed_vectors.items():
            if key in text_in:
                return list(vec)
        # Fallback: deterministic small vector from the text.
        h = abs(hash(text_in)) % 1_000_000
        rng = np.random.default_rng(h)
        return list(rng.standard_normal(8).astype(np.float32))

    return _embed


# ---------------------------------------------------------------------------
# Fixture loading
# ---------------------------------------------------------------------------


def _load_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text())


def _mem_row(
    tid: Any,
    *,
    stale: bool,
    turns: int,
    summary: str = "prior summary",
) -> _Row:
    """Build a thread_memory-shaped row."""
    now = datetime.now(timezone.utc)
    updated = now - timedelta(hours=48) if stale else now - timedelta(minutes=5)
    return _Row(
        thread_id=tid,
        rolling_summary_md=summary,
        turns_since_update=turns,
        updated_at=updated,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_refresh_writes_null_when_embedder_returns_none() -> None:
    """When ``embed_text`` returns None (placeholder path), the tick must
    write embedding=NULL + embedding_model=NULL. Storing a zero-vec here
    would silently poison future cos-similarity comparisons — we want
    real-embedder re-embed sweeps to be able to find these rows.
    """
    harness = SessionHarness()

    stale_tid = uuid.UUID("33333333-3333-3333-3333-333333333333")

    def prep(s: FakeSession) -> None:
        s.add_response(
            "rolling_summary_md",
            _FakeResult(rows=[_mem_row(stale_tid, stale=True, turns=0)]),
        )
        s.add_response(
            "where thread_id = any(:ids)",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    def none_embedder(_text: str) -> list[float] | None:
        return None

    result = tick(
        harness,
        llm_summarize=make_stub_llm(output="summary-null"),
        embed_text=none_embedder,
    )

    assert result["summaries_refreshed"] == 1

    # Find the UPDATE thread_memory call and verify both emb + model were NULL.
    updates = [
        (sql, params)
        for sql, params in harness.all_calls()
        if "update thread_memory" in sql.lower()
        and "set rolling_summary_md" in sql.lower()
    ]
    assert len(updates) == 1
    _, params = updates[0]
    assert params["emb"] is None
    assert params["model"] is None


def test_summary_refresh_when_stale() -> None:
    """Stale thread gets refreshed; fresh thread is skipped.

    We only return the stale row from the thread_memory SELECT — the tick
    never even sees the fresh thread. That's the module's contract.
    """
    harness = SessionHarness()

    stale_tid = uuid.UUID("11111111-1111-1111-1111-111111111111")

    # Response list assembled per-session by pre_hook.
    def prep(s: FakeSession) -> None:
        s.add_response(
            "rolling_summary_md",
            _FakeResult(rows=[_mem_row(stale_tid, stale=True, turns=0)]),
        )
        s.add_response(
            "where thread_id = any(:ids)",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    track: list[dict[str, Any]] = []
    result = tick(
        harness,
        llm_summarize=make_stub_llm(output="summary-A", track=track),
        embed_text=make_stub_embedder(),
    )

    assert result["summaries_refreshed"] == 1
    assert len(track) == 1
    assert track[0]["compact"] is False


def test_summary_refresh_when_turns_trigger() -> None:
    """turns_since_update > 10 triggers refresh even when updated_at is recent.

    We assert the SQL predicate actually references BOTH conditions so
    the DB is doing the OR, not the Python layer.
    """
    harness = SessionHarness()

    tid = uuid.UUID("22222222-2222-2222-2222-222222222222")

    def prep(s: FakeSession) -> None:
        s.add_response(
            "rolling_summary_md,",
            _FakeResult(rows=[_mem_row(tid, stale=False, turns=11)]),
        )
        s.add_response(
            "select thread_id, embedding",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder(),
    )

    assert result["summaries_refreshed"] == 1

    # SELECT must have both stale and turns predicates.
    select_sql = ""
    for s in harness.sessions:
        for sql, _ in s.calls:
            if "from thread_memory" in sql.lower() and "select thread_id" in sql.lower():
                select_sql = sql.lower()
                break
        if select_sql:
            break
    assert "updated_at <" in select_sql
    assert "turns_since_update >" in select_sql


def test_topic_overlap_edge_created() -> None:
    """Two refreshed threads with cosine ≥ 0.80 get a topic_overlap row."""
    harness = SessionHarness()

    tid_a = uuid.UUID("11111111-1111-1111-1111-111111111111")
    tid_b = uuid.UUID("22222222-2222-2222-2222-222222222222")

    # Both summaries contain the marker "ATTN" → same fixed vector.
    shared_vec = [1.0, 0.0, 0.0, 0.0]

    def prep(s: FakeSession) -> None:
        s.add_response(
            "select thread_id, embedding",
            _FakeResult(rows=[
                _Row(thread_id=tid_a,
                     embedding=np.asarray(shared_vec, dtype=np.float32).tobytes()),
                _Row(thread_id=tid_b,
                     embedding=np.asarray(shared_vec, dtype=np.float32).tobytes()),
            ]),
        )
        s.add_response(
            "rolling_summary_md,",
            _FakeResult(rows=[
                _mem_row(tid_a, stale=True, turns=0),
                _mem_row(tid_b, stale=True, turns=0),
            ]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(output="ATTN transformer summary"),
        embed_text=make_stub_embedder({"ATTN": shared_vec}),
    )

    assert result["summaries_refreshed"] == 2
    assert result["topic_edges"] == 1

    # The INSERT must target thread_link with kind=topic_overlap.
    found = False
    for s in harness.sessions:
        for sql, params in s.insert_calls_for("thread_link"):
            if params.get("kind") == "topic_overlap":
                found = True
                assert params["score"] >= 0.80
                # Endpoints ordered deterministically (min/max by str).
                assert str(params["a"]) <= str(params["b"])
    assert found, "expected at least one topic_overlap INSERT"


def test_citation_overlap_edge_created() -> None:
    """Two threads sharing ≥ 3 graph_node source_ids get a citation_overlap row."""
    harness = SessionHarness()

    tid_a = uuid.UUID("11111111-1111-1111-1111-111111111111")
    tid_b = uuid.UUID("22222222-2222-2222-2222-222222222222")

    # Different embeddings so topic_overlap doesn't fire.
    vec_a = [1.0, 0.0, 0.0, 0.0]
    vec_b = [0.0, 1.0, 0.0, 0.0]

    shared_rows = [
        _Row(thread_id=tid_a, source_id=101),
        _Row(thread_id=tid_a, source_id=102),
        _Row(thread_id=tid_a, source_id=103),
        _Row(thread_id=tid_a, source_id=104),
        _Row(thread_id=tid_b, source_id=101),
        _Row(thread_id=tid_b, source_id=102),
        _Row(thread_id=tid_b, source_id=103),
        _Row(thread_id=tid_b, source_id=201),
    ]

    def prep(s: FakeSession) -> None:
        s.add_response(
            "rolling_summary_md,",
            _FakeResult(rows=[
                _mem_row(tid_a, stale=True, turns=0),
                _mem_row(tid_b, stale=True, turns=0),
            ]),
        )
        s.add_response(
            "select thread_id, embedding",
            _FakeResult(rows=[
                _Row(thread_id=tid_a,
                     embedding=np.asarray(vec_a, dtype=np.float32).tobytes()),
                _Row(thread_id=tid_b,
                     embedding=np.asarray(vec_b, dtype=np.float32).tobytes()),
            ]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=shared_rows),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder({"A": vec_a, "B": vec_b}),
    )

    assert result["summaries_refreshed"] == 2
    assert result["topic_edges"] == 0
    assert result["citation_edges"] == 1

    found = False
    for s in harness.sessions:
        for _, params in s.insert_calls_for("thread_link"):
            if params.get("kind") == "citation_overlap":
                found = True
                # 3 shared / max(4,4) = 0.75
                assert params["score"] == pytest.approx(0.75)
                assert "3" in (params["reason"] or "")
    assert found, "expected citation_overlap INSERT"


def test_no_cold_thread_update_row_written() -> None:
    """Regression guard: the tick must never attempt an insert with
    kind='cold_thread_update'. That enum value was removed; cold-thread
    updates are computed dashboard-side on the fly.
    """
    harness = SessionHarness()

    tid_a = uuid.UUID("11111111-1111-1111-1111-111111111111")
    tid_b = uuid.UUID("22222222-2222-2222-2222-222222222222")

    # Make them VERY similar — embeddings identical, source overlap large
    # — to maximize chance the tick writes something. None of it should
    # be a cold_thread_update.
    vec = [1.0, 0.0, 0.0, 0.0]

    shared = [
        _Row(thread_id=tid_a, source_id=i) for i in range(101, 106)
    ] + [
        _Row(thread_id=tid_b, source_id=i) for i in range(101, 106)
    ]

    def prep(s: FakeSession) -> None:
        s.add_response(
            "rolling_summary_md,",
            _FakeResult(rows=[
                _mem_row(tid_a, stale=True, turns=0),
                _mem_row(tid_b, stale=True, turns=0),
            ]),
        )
        s.add_response(
            "select thread_id, embedding",
            _FakeResult(rows=[
                _Row(thread_id=tid_a,
                     embedding=np.asarray(vec, dtype=np.float32).tobytes()),
                _Row(thread_id=tid_b,
                     embedding=np.asarray(vec, dtype=np.float32).tobytes()),
            ]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=shared),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    tick(
        harness,
        llm_summarize=make_stub_llm(output="same topic"),
        embed_text=make_stub_embedder({"same topic": vec}),
    )

    # Scan every INSERT params for the forbidden kind.
    for s in harness.sessions:
        for sql, params in s.insert_calls_for("thread_link"):
            assert params.get("kind") != "cold_thread_update", (
                f"Forbidden cold_thread_update insert: {sql!r} {params!r}"
            )

    # Also assert the helper itself refuses.
    with pytest.raises(ValueError, match="cold_thread_update"):
        thread_synergy._upsert_thread_link(
            FakeSession(),
            a=tid_a, b=tid_b,
            kind="cold_thread_update",
            score=1.0, reason_md="should be blocked",
        )


def test_memory_compaction() -> None:
    """A summary overflowing the cap triggers a second (compacting) LLM pass.

    We drive the overflow by returning a long string from the first
    (non-compact) call; the tick must then invoke the stub a second
    time with ``compact=True`` and persist that shorter output.
    """
    harness = SessionHarness()

    tid = uuid.UUID("11111111-1111-1111-1111-111111111111")
    char_cap = 100

    def prep(s: FakeSession) -> None:
        s.add_response(
            "rolling_summary_md,",
            _FakeResult(rows=[_mem_row(tid, stale=True, turns=0)]),
        )
        s.add_response(
            "select thread_id, embedding",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    track: list[dict[str, Any]] = []
    llm = make_stub_llm(
        compact_output="tight",
        overflow_char_cap=char_cap,
        track=track,
    )

    result = tick(
        harness,
        llm_summarize=llm,
        embed_text=make_stub_embedder(),
        summary_char_cap=char_cap,
    )

    assert result["summaries_refreshed"] == 1
    # First call compact=False; second call compact=True.
    assert len(track) == 2
    assert track[0]["compact"] is False
    assert track[1]["compact"] is True

    # The persisted summary is the short compacted one.
    update_params = None
    for s in harness.sessions:
        for sql, params in s.calls:
            if "update thread_memory" in sql.lower() and "set rolling_summary_md" in sql.lower():
                update_params = params
    assert update_params is not None
    assert update_params["summary"] == "tight"


def test_dead_interest_flag_on_high_dismiss_rate() -> None:
    """UPDATE standing_interest SET auto_disable_suggested=TRUE is issued.

    We don't emulate the full per-row scan — that's Postgres's job via
    the LATERAL subquery — but we DO assert the UPDATE fires with the
    expected :window and :ratio params and that the tick counts the
    rowcount as the "flagged" return value.
    """
    harness = SessionHarness()

    def prep(s: FakeSession) -> None:
        s.add_response("select thread_id,", _FakeResult(rows=[]))
        s.add_response(
            "select thread_id, embedding",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=[]),
        )
        # Simulate 2 interests met the criterion.
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=2),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder(),
        dead_window=20,
        dead_dismiss_ratio=0.80,
    )
    assert result["dead_interests_flagged"] == 2

    # Find the actual UPDATE and confirm the params + SQL shape.
    found = False
    for s in harness.sessions:
        for sql, params in s.calls:
            low = sql.lower()
            if "update" in low and "standing_interest" in low and "auto_disable_suggested" in low:
                found = True
                assert params["window"] == 20
                assert params["ratio"] == pytest.approx(0.80)
                # Must scope to the last-N window per interest.
                assert "limit :window" in low or "order by found_at desc" in low
    assert found, "expected UPDATE standing_interest SET auto_disable_suggested"


def test_golden_fixture_overlaps() -> None:
    """Sanity check against the golden fixture.

    T1/T2 share topic AND ≥3 papers → both edges.
    T1/T3 share topic only → topic_overlap only.
    T4 is isolated → no edges touching T4.
    T5 shares papers with T1 but not topic → citation_overlap only.
    """
    fx = _load_fixture()
    by_id: dict[str, dict[str, Any]] = {t["id"]: t for t in fx["threads"]}
    tids = [uuid.UUID(t["id"]) for t in fx["threads"]]

    # Give each distinct topic a unique axis so cosine=1 within-topic
    # and 0 across-topic.
    topics = sorted({t["topic"] for t in fx["threads"]})
    axis: dict[str, list[float]] = {}
    for i, topic in enumerate(topics):
        v = [0.0] * len(topics)
        v[i] = 1.0
        axis[topic] = v

    vecs_by_tid = {
        uuid.UUID(t["id"]): axis[t["topic"]] for t in fx["threads"]
    }

    # Build a synthetic "graph_exploration + graph_node" result set:
    # for each thread emit (thread_id, source_id) per paper.
    graph_rows = []
    for t in fx["threads"]:
        tid = uuid.UUID(t["id"])
        for sid in t["papers"]:
            graph_rows.append(_Row(thread_id=tid, source_id=sid))

    # Embedding-byte map for the second session (fingerprint SELECT).
    fp_rows = [
        _Row(
            thread_id=tid,
            embedding=np.asarray(vecs_by_tid[tid], dtype=np.float32).tobytes(),
        )
        for tid in tids
    ]

    harness = SessionHarness()

    def prep(s: FakeSession) -> None:
        s.add_response(
            "rolling_summary_md,",
            _FakeResult(rows=[
                _mem_row(tid, stale=True, turns=0, summary=by_id[str(tid)]["topic"])
                for tid in tids
            ]),
        )
        s.add_response(
            "select thread_id, embedding",
            _FakeResult(rows=fp_rows),
        )
        s.add_response(
            "from public.graph_exploration",
            _FakeResult(rows=graph_rows),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(output="mixed"),
        embed_text=make_stub_embedder(
            {t["topic"]: axis[t["topic"]] for t in fx["threads"]}
        ),
    )

    assert result["summaries_refreshed"] == 5

    # Gather endpoint pairs per kind.
    topic_pairs: set[tuple[str, str]] = set()
    citation_pairs: set[tuple[str, str]] = set()
    for s in harness.sessions:
        for _, params in s.insert_calls_for("thread_link"):
            pair = tuple(sorted([str(params["a"]), str(params["b"])]))
            if params["kind"] == "topic_overlap":
                topic_pairs.add(pair)
            elif params["kind"] == "citation_overlap":
                citation_pairs.add(pair)

    t1 = "11111111-1111-1111-1111-111111111111"
    t2 = "22222222-2222-2222-2222-222222222222"
    t3 = "33333333-3333-3333-3333-333333333333"
    t4 = "44444444-4444-4444-4444-444444444444"
    t5 = "55555555-5555-5555-5555-555555555555"

    # Topic overlap: {T1,T2}, {T1,T3}, {T2,T3} all share topic.
    assert tuple(sorted([t1, t2])) in topic_pairs
    assert tuple(sorted([t1, t3])) in topic_pairs
    assert tuple(sorted([t2, t3])) in topic_pairs

    # Citation overlap: only {T1,T2} and {T1,T5} share ≥3 papers.
    assert tuple(sorted([t1, t2])) in citation_pairs
    assert tuple(sorted([t1, t5])) in citation_pairs

    # T4 is isolated — no edges touch it.
    for pair in topic_pairs | citation_pairs:
        assert t4 not in pair


def test_entity_overlap_edge_created() -> None:
    """Two threads sharing >= 3 entities get an entity_overlap row."""
    harness = SessionHarness()

    tid_a = uuid.UUID("11111111-1111-1111-1111-111111111111")
    tid_b = uuid.UUID("22222222-2222-2222-2222-222222222222")

    # Entities shared between the two threads.
    entity_rows = [
        _Row(thread_id=tid_a, name="CRISPR-Cas9"),
        _Row(thread_id=tid_a, name="GPT-4"),
        _Row(thread_id=tid_a, name="AlphaFold"),
        _Row(thread_id=tid_a, name="DeepMind"),
        _Row(thread_id=tid_b, name="CRISPR-Cas9"),
        _Row(thread_id=tid_b, name="GPT-4"),
        _Row(thread_id=tid_b, name="AlphaFold"),
        _Row(thread_id=tid_b, name="OpenAI"),
    ]

    def prep(s: FakeSession) -> None:
        # No stale threads — skip the summary refresh.
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        # Entity rows for the entity overlap step.
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=entity_rows),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder(),
    )

    assert result["entity_edges"] == 1

    # Find the INSERT and verify kind + score.
    found = False
    for s in harness.sessions:
        for _, params in s.insert_calls_for("thread_link"):
            if params.get("kind") == "entity_overlap":
                found = True
                # 3 shared / max(4, 4) = 0.75
                assert params["score"] == pytest.approx(0.75)
                assert "3" in (params["reason"] or "")
                assert "CRISPR" in (params["reason"] or "")
    assert found, "expected entity_overlap INSERT"


def test_entity_overlap_below_threshold_no_edge() -> None:
    """Threads sharing < 3 entities do NOT get an entity_overlap row."""
    harness = SessionHarness()

    tid_a = uuid.UUID("11111111-1111-1111-1111-111111111111")
    tid_b = uuid.UUID("22222222-2222-2222-2222-222222222222")

    # Only 2 shared entities — below default threshold of 3.
    entity_rows = [
        _Row(thread_id=tid_a, name="CRISPR-Cas9"),
        _Row(thread_id=tid_a, name="GPT-4"),
        _Row(thread_id=tid_a, name="AlphaFold"),
        _Row(thread_id=tid_b, name="CRISPR-Cas9"),
        _Row(thread_id=tid_b, name="GPT-4"),
        _Row(thread_id=tid_b, name="OpenAI"),
    ]

    def prep(s: FakeSession) -> None:
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=entity_rows),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder(),
    )

    assert result["entity_edges"] == 0

    for s in harness.sessions:
        for _, params in s.insert_calls_for("thread_link"):
            assert params.get("kind") != "entity_overlap"


def test_entity_overlap_custom_threshold() -> None:
    """Custom entity_shared_threshold is respected."""
    harness = SessionHarness()

    tid_a = uuid.UUID("11111111-1111-1111-1111-111111111111")
    tid_b = uuid.UUID("22222222-2222-2222-2222-222222222222")

    # 2 shared entities — below default (3) but meets threshold=2.
    entity_rows = [
        _Row(thread_id=tid_a, name="CRISPR-Cas9"),
        _Row(thread_id=tid_a, name="GPT-4"),
        _Row(thread_id=tid_b, name="CRISPR-Cas9"),
        _Row(thread_id=tid_b, name="GPT-4"),
    ]

    def prep(s: FakeSession) -> None:
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=entity_rows),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder(),
        entity_shared_threshold=2,
    )

    assert result["entity_edges"] == 1


def test_entity_overlap_no_entities() -> None:
    """No note_entity rows → entity_edges stays at 0 and no crash."""
    harness = SessionHarness()

    def prep(s: FakeSession) -> None:
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder(),
    )

    assert result["entity_edges"] == 0


def test_entity_edges_in_as_dict() -> None:
    """SynergyResult.as_dict() includes entity_edges."""
    r = thread_synergy.SynergyResult(entity_edges=5)
    d = r.as_dict()
    assert d["entity_edges"] == 5
    assert "entity_edges" in d


# ---------------------------------------------------------------------------
# Note backfill tests
# ---------------------------------------------------------------------------


def test_notes_backfill_processes_unextracted() -> None:
    """Unextracted note_index rows get entity extraction + embedding."""
    harness = SessionHarness()

    tid = uuid.UUID("11111111-1111-1111-1111-111111111111")
    nid = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    unextracted_row = _Row(
        id=nid,
        thread_id=tid,
        note_id="note-001",
        title="CRISPR Applications",
        kind="observation",
        content_hash="abc123",
    )

    def prep(s: FakeSession) -> None:
        # No stale threads — skip summary refresh.
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        # Backfill query returns one unextracted note.
        s.add_response(
            "from note_index ni",
            _FakeResult(rows=[unextracted_row]),
        )
        # Entity overlap query — empty after backfill.
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    # LLM stub returns valid entity JSON that _parse_entities can parse.
    def entity_llm(*, prior_summary: str, turns: list[str], compact: bool) -> str:
        return '[{"name": "CRISPR-Cas9", "type": "method", "salience": 0.9}]'

    result = tick(
        harness,
        llm_summarize=entity_llm,
        embed_text=make_stub_embedder(),
    )

    assert result["notes_backfilled"] == 1

    # Verify entity INSERT was issued.
    found_entity_insert = False
    found_embedding_update = False
    found_extracted_at = False
    for s in harness.sessions:
        for sql, params in s.calls:
            low = sql.lower()
            if "insert into note_entity" in low:
                found_entity_insert = True
                assert params["name"] == "CRISPR-Cas9"
                assert params["etype"] == "method"
            if "update note_index" in low and "embedding" in low:
                found_embedding_update = True
            if "update note_index" in low and "extracted_at" in low:
                found_extracted_at = True

    assert found_entity_insert, "expected INSERT INTO note_entity"
    assert found_embedding_update, "expected UPDATE note_index SET embedding"
    assert found_extracted_at, "expected UPDATE note_index SET extracted_at"


def test_notes_backfill_no_unextracted() -> None:
    """When no note_index rows need backfill, notes_backfilled stays at 0."""
    harness = SessionHarness()

    def prep(s: FakeSession) -> None:
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        # No unextracted notes.
        s.add_response("from note_index ni", _FakeResult(rows=[]))
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    result = tick(
        harness,
        llm_summarize=make_stub_llm(),
        embed_text=make_stub_embedder(),
    )

    assert result["notes_backfilled"] == 0


def test_notes_backfill_llm_failure_does_not_crash() -> None:
    """If LLM fails during backfill, the note is skipped but the tick continues."""
    harness = SessionHarness()

    tid = uuid.UUID("11111111-1111-1111-1111-111111111111")
    nid = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    unextracted_row = _Row(
        id=nid,
        thread_id=tid,
        note_id="note-fail",
        title="Failing Note",
        kind="observation",
        content_hash="xyz",
    )

    def prep(s: FakeSession) -> None:
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        s.add_response("from note_index ni", _FakeResult(rows=[unextracted_row]))
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    # LLM raises an exception.
    def boom_llm(*, prior_summary: str, turns: list[str], compact: bool) -> str:
        raise RuntimeError("LLM exploded")

    result = tick(
        harness,
        llm_summarize=boom_llm,
        embed_text=make_stub_embedder(),
    )

    # Backfill failed for this note but the tick completed.
    assert result["notes_backfilled"] == 0
    assert result["entity_edges"] == 0
    assert result["dead_interests_flagged"] == 0


def test_notes_backfilled_in_as_dict() -> None:
    """SynergyResult.as_dict() includes notes_backfilled."""
    r = thread_synergy.SynergyResult(notes_backfilled=3)
    d = r.as_dict()
    assert d["notes_backfilled"] == 3
    assert "notes_backfilled" in d


def test_notes_backfill_with_none_embedding() -> None:
    """Backfill proceeds even when embedder returns None."""
    harness = SessionHarness()

    tid = uuid.UUID("11111111-1111-1111-1111-111111111111")
    nid = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    unextracted_row = _Row(
        id=nid,
        thread_id=tid,
        note_id="note-no-embed",
        title="No Embedding Note",
        kind="claim",
        content_hash="noemb",
    )

    def prep(s: FakeSession) -> None:
        s.add_response("rolling_summary_md,", _FakeResult(rows=[]))
        s.add_response("from note_index ni", _FakeResult(rows=[unextracted_row]))
        s.add_response(
            "select thread_id, name from note_entity",
            _FakeResult(rows=[]),
        )
        s.add_response(
            "auto_disable_suggested = true",
            _FakeResult(rowcount=0),
        )

    harness.add_pre_hook(prep)

    def entity_llm(*, prior_summary: str, turns: list[str], compact: bool) -> str:
        return '[{"name": "X", "type": "concept", "salience": 0.5}]'

    def none_embedder(_text: str) -> list[float] | None:
        return None

    result = tick(
        harness,
        llm_summarize=entity_llm,
        embed_text=none_embedder,
    )

    assert result["notes_backfilled"] == 1

    # No embedding UPDATE should have been issued.
    embedding_updates = [
        (sql, params)
        for s in harness.sessions
        for sql, params in s.calls
        if "update note_index" in sql.lower() and "embedding = :emb" in sql.lower()
    ]
    assert len(embedding_updates) == 0

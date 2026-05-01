"""Tests for ``research_backend.clustering.cluster_exploration``.

All unit tests — no DB, no network. The S2 client is stubbed via
:class:`unittest.mock.AsyncMock`; the session is a tiny fake that returns
a pre-seeded list of (source_id, s2_paper_id, influence_score) rows for
the one SELECT the clustering module issues.

Embeddings are synthetic: each "cluster" is a tight blob around a basis
vector in 8-dim space (8 dims is plenty for HDBSCAN to separate three
well-separated clouds, and keeps the test fixtures readable). Every
test seeds ``numpy`` before generating points so HDBSCAN sees the same
matrix on every run.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from typing import Any
from unittest.mock import AsyncMock

import numpy as np
import pytest

from research_backend.clustering import cluster_exploration

# ---------------------------------------------------------------------------
# Fake session / S2 scaffolding
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return list(self._rows)

    def first(self) -> Any:
        return self._rows[0] if self._rows else None


class _Row:
    def __init__(self, **kwargs: Any) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)


class FakeSession:
    def __init__(self, rows: list[_Row]) -> None:
        self._rows = rows
        self.executed: list[tuple[str, dict[str, Any]]] = []

    def execute(
        self, stmt: Any, params: dict[str, Any] | None = None
    ) -> _FakeResult:
        self.executed.append((str(stmt), dict(params or {})))
        return _FakeResult(self._rows)

    def commit(self) -> None:
        pass

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *args: Any) -> None:
        return None


def make_session_factory(
    triples: list[tuple[int, str, float]],
) -> Any:
    """Build a factory whose sessions return the given ``(source_id,
    s2_paper_id, influence_score)`` triples for the one SELECT the
    clustering module runs.
    """
    rows = [
        _Row(source_id=sid, s2_paper_id=s2_id, influence_score=score)
        for sid, s2_id, score in triples
    ]

    @contextmanager
    def factory() -> Any:
        yield FakeSession(rows)

    return factory


def make_s2_mock(
    embeddings_by_s2_id: dict[str, list[float] | None],
) -> AsyncMock:
    """Return an ``AsyncMock`` whose ``.embedding(s2_id)`` returns the
    matching S2 embedding envelope. Passing ``None`` for a value yields
    an empty response (missing-embedding case).
    """
    mock = AsyncMock()

    async def _embedding(paper_id: str) -> dict:
        vec = embeddings_by_s2_id.get(paper_id)
        if vec is None:
            return {}
        return {
            "paperId": paper_id,
            "embedding": {"model": "specter_v2", "vector": vec},
        }

    mock.embedding.side_effect = _embedding
    return mock


# ---------------------------------------------------------------------------
# Synthetic embedding helpers
# ---------------------------------------------------------------------------


_DIM = 8


def _unit_axis(index: int) -> np.ndarray:
    """One-hot basis vector in 8-D space, used as a cluster center."""
    vec = np.zeros(_DIM, dtype=np.float64)
    vec[index] = 1.0
    return vec


def _jitter_around(center: np.ndarray, sigma: float = 0.03) -> np.ndarray:
    """Return ``center`` + small Gaussian noise. Caller is responsible
    for seeding numpy so results are reproducible.
    """
    return center + np.random.normal(0.0, sigma, size=_DIM)


def _make_three_cluster_fixture(
    per_cluster: int = 6,
    seed: int = 42,
) -> tuple[list[tuple[int, str, float]], dict[str, list[float]]]:
    """Build a fixture with three well-separated clusters, each around a
    different basis axis. Returns ``(triples, embeddings_by_s2_id)``.
    """
    np.random.seed(seed)
    triples: list[tuple[int, str, float]] = []
    embeddings: dict[str, list[float]] = {}
    centers = [_unit_axis(0), _unit_axis(1), _unit_axis(2)]
    source_id = 1
    for cluster_idx, center in enumerate(centers):
        for i in range(per_cluster):
            s2_id = f"c{cluster_idx}_p{i}"
            triples.append((source_id, s2_id, float(i)))  # influence scores vary
            embeddings[s2_id] = _jitter_around(center).tolist()
            source_id += 1
    return triples, embeddings


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_cluster_returns_correct_n_papers():
    triples, embeddings = _make_three_cluster_fixture(per_cluster=6, seed=1)
    s2 = make_s2_mock(embeddings)
    factory = make_session_factory(triples)

    result = await cluster_exploration(
        s2=s2,
        session_factory=factory,
        vault_schema="research_vault",
        exploration_id=uuid.uuid4(),
        min_cluster_size=3,
    )

    # 3 clusters * 6 per cluster = 18 papers, all with valid embeddings.
    assert result["n_papers"] == 18
    # noise + sum(cluster sizes) should equal n_papers.
    total_in_clusters = sum(c["size"] for c in result["clusters"])
    assert total_in_clusters + result["noise_count"] == result["n_papers"]


async def test_cluster_finds_expected_clusters():
    triples, embeddings = _make_three_cluster_fixture(per_cluster=7, seed=2)
    s2 = make_s2_mock(embeddings)
    factory = make_session_factory(triples)

    result = await cluster_exploration(
        s2=s2,
        session_factory=factory,
        vault_schema="research_vault",
        exploration_id=uuid.uuid4(),
        min_cluster_size=3,
    )

    # HDBSCAN is heuristic — well-separated 7-point blobs at orthogonal
    # unit axes should yield 3 clusters, but we allow ±1 drift.
    assert abs(result["n_clusters"] - 3) <= 1


async def test_cluster_handles_too_few_papers():
    # Only 2 papers → below min_cluster_size * 2 (= 6) short-circuit.
    triples = [(1, "a", 1.0), (2, "b", 2.0)]
    embeddings = {
        "a": _unit_axis(0).tolist(),
        "b": _unit_axis(1).tolist(),
    }
    s2 = make_s2_mock(embeddings)
    factory = make_session_factory(triples)

    result = await cluster_exploration(
        s2=s2,
        session_factory=factory,
        vault_schema="research_vault",
        exploration_id=uuid.uuid4(),
        min_cluster_size=3,
    )

    assert result == {
        "n_papers": 2,
        "n_clusters": 0,
        "noise_count": 2,
        "clusters": [],
    }


async def test_cluster_top_papers_ordered_by_influence():
    # One tight cluster of 8 points near the origin + a second blob far
    # away (so HDBSCAN has a density contrast to work with and doesn't
    # lump everything into noise). We assert ordering on the main cluster.
    np.random.seed(7)
    center_main = _unit_axis(0)
    center_far = _unit_axis(4) * 5.0
    triples: list[tuple[int, str, float]] = []
    embeddings: dict[str, list[float]] = {}
    # Main cluster: 8 points with influences 10, 9, ..., 3.
    for i in range(8):
        s2_id = f"p{i}"
        triples.append((100 + i, s2_id, 10.0 - i))
        embeddings[s2_id] = _jitter_around(center_main, sigma=0.05).tolist()
    # Filler cluster so HDBSCAN has >= 2 density regions. These papers
    # aren't asserted on — they just keep the algorithm honest.
    for i in range(8):
        s2_id = f"f{i}"
        triples.append((200 + i, s2_id, 0.0))
        embeddings[s2_id] = _jitter_around(center_far, sigma=0.05).tolist()

    s2 = make_s2_mock(embeddings)
    factory = make_session_factory(triples)

    result = await cluster_exploration(
        s2=s2,
        session_factory=factory,
        vault_schema="research_vault",
        exploration_id=uuid.uuid4(),
        min_cluster_size=3,
    )

    # Find the cluster containing source_id 100 — that's "main".
    main = next(
        c for c in result["clusters"] if 100 in c["paper_source_ids"]
    )
    # Top papers are the most-influential members of that cluster in
    # descending influence order. Cluster size may be <= 8 if HDBSCAN
    # pulls an edge point into noise, but ordering must still hold.
    expected_order = sorted(
        [sid for sid in main["paper_source_ids"] if 100 <= sid < 200],
        key=lambda s: -(10.0 - (s - 100)),  # reconstruct influence
    )
    assert main["paper_source_ids"] == expected_order
    # Top 5 is just the prefix.
    assert main["top_papers"] == expected_order[:5]
    # Sanity: the single most-influential paper (100) is at the top.
    assert main["top_papers"][0] == 100


async def test_cluster_skips_missing_embeddings():
    # 12 papers: 6 in each of two clusters. But 3 have no embedding.
    np.random.seed(11)
    triples: list[tuple[int, str, float]] = []
    embeddings: dict[str, list[float] | None] = {}
    for cluster_idx, center in enumerate([_unit_axis(0), _unit_axis(1)]):
        for i in range(6):
            s2_id = f"c{cluster_idx}_p{i}"
            triples.append((cluster_idx * 100 + i, s2_id, float(i)))
            # First paper of each cluster has a missing embedding.
            if i == 0:
                embeddings[s2_id] = None
            else:
                embeddings[s2_id] = _jitter_around(center).tolist()
    # Also a third paper with an outright malformed (empty vector)
    # response, exercising the "empty vector" branch of _extract_vector.
    triples.append((999, "malformed", 0.0))
    embeddings["malformed"] = None  # mock returns {} → no embedding

    s2 = make_s2_mock(embeddings)
    factory = make_session_factory(triples)

    result = await cluster_exploration(
        s2=s2,
        session_factory=factory,
        vault_schema="research_vault",
        exploration_id=uuid.uuid4(),
        min_cluster_size=3,
    )

    # 13 input rows, 3 with missing embeddings → 10 kept.
    assert result["n_papers"] == 10
    # Both remaining clusters should be detectable (5 points each).
    assert result["n_clusters"] >= 1


async def test_cluster_noise_separate_from_clusters():
    # Two tight clusters plus one orphan point in a completely different
    # region of embedding space. The orphan should be noise.
    np.random.seed(13)
    triples: list[tuple[int, str, float]] = []
    embeddings: dict[str, list[float]] = {}
    for cluster_idx, center in enumerate([_unit_axis(0), _unit_axis(1)]):
        for i in range(6):
            s2_id = f"c{cluster_idx}_p{i}"
            triples.append((cluster_idx * 100 + i, s2_id, float(i)))
            embeddings[s2_id] = _jitter_around(center, sigma=0.01).tolist()
    # Orphan: far away in dim 5, not near either cluster center.
    orphan_center = np.zeros(_DIM, dtype=np.float64)
    orphan_center[5] = 10.0
    triples.append((999, "orphan", 0.0))
    embeddings["orphan"] = orphan_center.tolist()

    s2 = make_s2_mock(embeddings)
    factory = make_session_factory(triples)

    result = await cluster_exploration(
        s2=s2,
        session_factory=factory,
        vault_schema="research_vault",
        exploration_id=uuid.uuid4(),
        min_cluster_size=3,
    )

    # 13 papers, noise should include at least the orphan.
    assert result["n_papers"] == 13
    assert result["noise_count"] >= 1
    # The orphan's source_id (999) should NOT appear in any cluster.
    clustered = {
        sid for cluster in result["clusters"] for sid in cluster["paper_source_ids"]
    }
    assert 999 not in clustered


async def test_cluster_empty_exploration():
    # Zero papers → zero clusters, no S2 calls.
    s2 = make_s2_mock({})
    factory = make_session_factory([])

    result = await cluster_exploration(
        s2=s2,
        session_factory=factory,
        vault_schema="research_vault",
        exploration_id=uuid.uuid4(),
        min_cluster_size=3,
    )

    assert result == {
        "n_papers": 0,
        "n_clusters": 0,
        "noise_count": 0,
        "clusters": [],
    }
    s2.embedding.assert_not_called()


async def test_cluster_rejects_invalid_schema():
    with pytest.raises(ValueError, match="invalid vault schema"):
        await cluster_exploration(
            s2=make_s2_mock({}),
            session_factory=make_session_factory([]),
            vault_schema="public",
            exploration_id=uuid.uuid4(),
        )

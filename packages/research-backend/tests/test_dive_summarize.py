"""Tests for :mod:`research_backend.dive.summarize`.

All unit tests — no network, no real LLM. The prompt builder is pure
string manipulation so its tests are plain ``assert in`` checks. The
LLM orchestration is exercised via an injected fake callable; both
async and sync callables are tested to match the real provider
surface (``asyncio.to_thread``-wrapped sync generate vs. native async).
"""

from __future__ import annotations

from typing import Any

import pytest

from research_backend.dive.summarize import (
    SUMMARIZE_SYSTEM_PROMPT,
    build_prompt,
    summarize_dive,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SEEDS = [
    {
        "title": "Attention Is All You Need",
        "authors": ["Vaswani", "Shazeer"],
        "year": 2017,
        "source_id": 1,
        "s2_paper_id": "seed-a",
    },
    {
        "title": "BERT: Pre-training of Deep Bidirectional Transformers",
        "authors": ["Devlin", "Chang"],
        "year": 2018,
        "source_id": 2,
        "s2_paper_id": "seed-b",
    },
]


def _cluster(label: int, titles: list[str]) -> dict:
    return {
        "cluster_id": label,
        "size": len(titles),
        "paper_source_ids": list(range(100, 100 + len(titles))),
        "top_papers": [
            {
                "title": t,
                "authors": [f"Author{i}"],
                "year": 2020 + i,
                "influence_score": 0.5,
            }
            for i, t in enumerate(titles)
        ],
    }


CLUSTERS_TWO = {
    "n_papers": 6,
    "n_clusters": 2,
    "noise_count": 0,
    "clusters": [
        _cluster(
            0,
            ["Sparse Attention", "Linear Attention", "Performer Kernels"],
        ),
        _cluster(
            1,
            ["Masked LM Scaling", "Contrastive Pretraining", "Retrieval Augmentation"],
        ),
    ],
}

CLUSTERS_EMPTY = {
    "n_papers": 3,
    "n_clusters": 0,
    "noise_count": 3,
    "clusters": [],
}

VISITED = [
    {
        "title": "Mamba Sequence Models",
        "authors": ["Gu"],
        "year": 2023,
        "influence_score": 0.9,
    },
    {
        "title": "Obscure Tangent",
        "authors": ["Nobody"],
        "year": 2015,
        "influence_score": 0.01,
    },
]


# ---------------------------------------------------------------------------
# build_prompt tests
# ---------------------------------------------------------------------------


def test_build_prompt_contains_seed_titles() -> None:
    prompt = build_prompt(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
    )
    assert "Attention Is All You Need" in prompt
    assert "BERT: Pre-training of Deep Bidirectional Transformers" in prompt


def test_build_prompt_contains_cluster_top_papers() -> None:
    prompt = build_prompt(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
    )
    expected_titles = [
        "Sparse Attention",
        "Linear Attention",
        "Performer Kernels",
        "Masked LM Scaling",
        "Contrastive Pretraining",
        "Retrieval Augmentation",
    ]
    for title in expected_titles:
        assert title in prompt, f"missing cluster paper title: {title}"


def test_build_prompt_handles_empty_clusters() -> None:
    prompt = build_prompt(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_EMPTY,
        focus="balanced",
    )
    assert "clustering unavailable" in prompt.lower()
    # Flat fallback should include the highest-influence visited paper.
    assert "Mamba Sequence Models" in prompt


def test_build_prompt_handles_missing_clusters_dict() -> None:
    prompt = build_prompt(
        seeds=SEEDS,
        visited=VISITED,
        clusters={},
        focus="balanced",
    )
    assert "clustering unavailable" in prompt.lower()


def test_build_prompt_includes_focus() -> None:
    prompt = build_prompt(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="foundational",
    )
    assert "foundational" in prompt
    assert "Focus:" in prompt


def test_build_prompt_tolerates_missing_fields() -> None:
    """Papers missing authors/year should still render without crashing."""
    prompt = build_prompt(
        seeds=[{"title": "Bare Paper"}],
        visited=[{"title": "Visited Bare", "influence_score": 0.5}],
        clusters=CLUSTERS_EMPTY,
        focus="balanced",
    )
    assert "Bare Paper" in prompt
    assert "Unknown" in prompt  # author fallback
    assert "n.d." in prompt  # year fallback


# ---------------------------------------------------------------------------
# summarize_dive tests
# ---------------------------------------------------------------------------


async def test_summarize_calls_injected_llm_with_prompt() -> None:
    calls: list[dict[str, Any]] = []

    async def fake_llm(**kwargs: Any) -> str:
        calls.append(kwargs)
        return "# Summary"

    result = await summarize_dive(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
        llm=fake_llm,
    )

    assert result == "# Summary"
    assert len(calls) == 1
    call = calls[0]
    assert call["system"] == SUMMARIZE_SYSTEM_PROMPT
    assert "Attention Is All You Need" in call["prompt"]
    assert "Sparse Attention" in call["prompt"]
    assert call["model"]  # some model was chosen


async def test_summarize_respects_model_override() -> None:
    captured: dict[str, Any] = {}

    async def fake_llm(**kwargs: Any) -> str:
        captured.update(kwargs)
        return "ok"

    await summarize_dive(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
        llm=fake_llm,
        model="claude-haiku",
    )

    assert captured.get("model") == "claude-haiku"


async def test_summarize_uses_env_model_when_no_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUMMARIZE_MODEL", "env-picked-model")
    captured: dict[str, Any] = {}

    async def fake_llm(**kwargs: Any) -> str:
        captured.update(kwargs)
        return "ok"

    await summarize_dive(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
        llm=fake_llm,
    )

    assert captured.get("model") == "env-picked-model"


async def test_summarize_defaults_to_gpt_4o_mini(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUMMARIZE_MODEL", raising=False)
    captured: dict[str, Any] = {}

    async def fake_llm(**kwargs: Any) -> str:
        captured.update(kwargs)
        return "ok"

    await summarize_dive(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
        llm=fake_llm,
    )

    assert captured.get("model") == "gpt-4o-mini"


async def test_summarize_raises_on_llm_failure() -> None:
    class BoomError(RuntimeError):
        pass

    async def failing_llm(**_: Any) -> str:
        raise BoomError("upstream exploded")

    with pytest.raises(BoomError, match="upstream exploded"):
        await summarize_dive(
            seeds=SEEDS,
            visited=VISITED,
            clusters=CLUSTERS_TWO,
            focus="balanced",
            llm=failing_llm,
        )


async def test_summarize_returns_text_from_llm() -> None:
    expected = "## The dive found interesting things\n\nBullets…"

    async def fake_llm(**_: Any) -> str:
        return expected

    result = await summarize_dive(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
        llm=fake_llm,
    )

    assert result == expected


async def test_summarize_accepts_sync_llm() -> None:
    """Real ``provider.generate`` is sync; the dispatch must handle that."""
    def sync_llm(**_: Any) -> str:
        return "sync-result"

    result = await summarize_dive(
        seeds=SEEDS,
        visited=VISITED,
        clusters=CLUSTERS_TWO,
        focus="balanced",
        llm=sync_llm,
    )

    assert result == "sync-result"

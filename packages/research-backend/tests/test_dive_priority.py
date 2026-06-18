"""Tests for ``research_backend.dive.priority``.

Pure unit tests — no DB, no HTTP, no S2 fixtures. Every assertion exercises
the scoring helpers on hand-crafted dicts so failures point directly at a
single scoring decision.
"""

from __future__ import annotations

import math

import pytest

from research_backend.dive.priority import (
    FOCUS_WEIGHTS,
    citation_overlap,
    embedding_sim,
    influence_score,
    priority,
    recency_boost,
    unseen_author_bonus,
)

# ---------------------------------------------------------------------------
# Focus weights
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("focus", list(FOCUS_WEIGHTS.keys()))
def test_weights_sum_to_one(focus: str) -> None:
    total = sum(FOCUS_WEIGHTS[focus].values())
    assert math.isclose(total, 1.0, abs_tol=1e-9), (focus, total)


# ---------------------------------------------------------------------------
# citation_overlap
# ---------------------------------------------------------------------------


def test_citation_overlap_counts_shared_refs() -> None:
    paper = {"references": [{"paperId": "A"}, {"paperId": "B"}]}
    seed = {"references": [{"paperId": "A"}, {"paperId": "C"}]}
    assert citation_overlap(paper, [seed]) == 1


def test_citation_overlap_multiple_seeds() -> None:
    paper = {
        "references": [{"paperId": "A"}, {"paperId": "B"}, {"paperId": "C"}],
    }
    seed1 = {"references": [{"paperId": "A"}]}
    seed2 = {"references": [{"paperId": "B"}]}
    # A matches seed1, B matches seed2, C matches neither → overlap = 2.
    assert citation_overlap(paper, [seed1, seed2]) == 2


def test_citation_overlap_no_refs_returns_zero() -> None:
    assert citation_overlap({"references": []}, [{"references": [{"paperId": "A"}]}]) == 0
    assert citation_overlap({}, [{"references": [{"paperId": "A"}]}]) == 0


# ---------------------------------------------------------------------------
# influence_score
# ---------------------------------------------------------------------------


def test_influence_score_clamps() -> None:
    # Shouldn't happen in practice, but defend against dirty data.
    paper = {"influentialCitationCount": 20, "citationCount": 10}
    assert influence_score(paper) == 1.0


def test_influence_score_missing_fields() -> None:
    assert influence_score({}) == 0.0
    # Only influential count, no total → denominator floored to 1, but since
    # influential is 0/missing we return 0.
    assert influence_score({"influentialCitationCount": 0}) == 0.0


def test_influence_score_basic_ratio() -> None:
    paper = {"influentialCitationCount": 3, "citationCount": 12}
    assert influence_score(paper) == pytest.approx(0.25)


# ---------------------------------------------------------------------------
# recency_boost
# ---------------------------------------------------------------------------


def test_recency_boost_favors_newer() -> None:
    assert recency_boost(2025, reference_year=2026) > recency_boost(2010, reference_year=2026)


def test_recency_boost_zero_for_very_old() -> None:
    assert recency_boost(2000, reference_year=2026) == 0.0


def test_recency_boost_none_year() -> None:
    assert recency_boost(None) == 0.0


def test_recency_boost_current_year_is_one() -> None:
    assert recency_boost(2026, reference_year=2026) == 1.0


# ---------------------------------------------------------------------------
# embedding_sim
# ---------------------------------------------------------------------------


def test_embedding_sim_orthogonal() -> None:
    assert embedding_sim([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_embedding_sim_identical() -> None:
    vec = [0.6, 0.8, 0.0]
    assert embedding_sim(vec, vec) == pytest.approx(1.0)


def test_embedding_sim_zero_vector_safe() -> None:
    result = embedding_sim([1.0, 2.0, 3.0], [0.0, 0.0, 0.0])
    assert result == 0.0
    assert not math.isnan(result)


def test_embedding_sim_accepts_numpy_and_list() -> None:
    import numpy as np

    a = np.array([1.0, 0.0, 0.0])
    b = [1.0, 0.0, 0.0]
    assert embedding_sim(a, b) == pytest.approx(1.0)


def test_embedding_sim_negative_cosine_clamped() -> None:
    # Opposing vectors have cosine = -1; clamped up to 0 so anti-correlation
    # doesn't rank below missing data.
    assert embedding_sim([1.0, 0.0], [-1.0, 0.0]) == 0.0


# ---------------------------------------------------------------------------
# unseen_author_bonus
# ---------------------------------------------------------------------------


def test_unseen_author_all_known() -> None:
    paper = {"authors": [{"name": "Alice"}, {"name": "Bob"}]}
    assert unseen_author_bonus(paper, {"alice", "bob"}) == 0.0


def test_unseen_author_all_new() -> None:
    paper = {"authors": [{"name": "Alice"}, {"name": "Bob"}]}
    assert unseen_author_bonus(paper, set()) == 1.0


def test_unseen_author_half() -> None:
    paper = {"authors": [{"name": "Alice"}, {"name": "Bob"}]}
    assert unseen_author_bonus(paper, {"alice"}) == 0.5


def test_unseen_author_missing_authors() -> None:
    assert unseen_author_bonus({}, set()) == 0.0
    assert unseen_author_bonus({"authors": []}, set()) == 0.0


# ---------------------------------------------------------------------------
# priority composite
# ---------------------------------------------------------------------------


def _composite_fixture() -> dict:
    """Return a paper dict engineered to hit specific component values.

    Component values (balanced focus, reference_year=2026):

    * overlap:        3 shared refs / 5-ref paper = 0.6
    * influence:      4 / 10 = 0.4
    * sim:            identical embeddings = 1.0
    * recency:        year=2024, age=2, 1 - 2/20 = 0.9
    * unseen_author:  1 of 2 authors new = 0.5

    Score = 0.35*0.6 + 0.25*0.4 + 0.20*1.0 + 0.15*0.9 + 0.05*0.5
          = 0.210 + 0.100 + 0.200 + 0.135 + 0.025
          = 0.670
    """
    return {
        "references": [
            {"paperId": "A"},
            {"paperId": "B"},
            {"paperId": "C"},
            {"paperId": "D"},
            {"paperId": "E"},
        ],
        "citationCount": 10,
        "influentialCitationCount": 4,
        "year": 2024,
        "authors": [{"name": "Alice"}, {"name": "Bob"}],
        "embedding": [1.0, 0.0, 0.0],
    }


def _composite_seeds() -> list[dict]:
    # Together the seeds cover A, B, C (and an unrelated X that shouldn't
    # contribute).
    return [
        {"references": [{"paperId": "A"}, {"paperId": "B"}]},
        {"references": [{"paperId": "C"}, {"paperId": "X"}]},
    ]


def test_priority_composite_balanced() -> None:
    paper = _composite_fixture()
    seeds = _composite_seeds()
    result = priority(
        paper,
        seeds,
        focus_embedding=[1.0, 0.0, 0.0],
        seen_authors={"alice"},
        focus="balanced",
        reference_year=2026,
    )
    assert 0.0 <= result <= 1.0
    assert result == pytest.approx(0.670, abs=1e-6)


def test_priority_unknown_focus_uses_balanced() -> None:
    paper = _composite_fixture()
    seeds = _composite_seeds()
    kwargs = dict(
        seeds=seeds,
        focus_embedding=[1.0, 0.0, 0.0],
        seen_authors={"alice"},
        reference_year=2026,
    )
    balanced = priority(paper, focus="balanced", **kwargs)
    bogus = priority(paper, focus="bogus", **kwargs)
    assert balanced == pytest.approx(bogus)


def test_priority_no_focus_embedding_zeros_sim_component() -> None:
    paper = _composite_fixture()
    seeds = _composite_seeds()
    with_embed = priority(
        paper,
        seeds,
        focus_embedding=[1.0, 0.0, 0.0],
        seen_authors={"alice"},
        focus="balanced",
        reference_year=2026,
    )
    without_embed = priority(
        paper,
        seeds,
        focus_embedding=None,
        seen_authors={"alice"},
        focus="balanced",
        reference_year=2026,
    )
    # Dropping the similarity component should subtract exactly
    # weights["sim"] * sim_norm = 0.20 * 1.0 from the score.
    sim_weight = FOCUS_WEIGHTS["balanced"]["sim"]
    assert with_embed - without_embed == pytest.approx(sim_weight * 1.0, abs=1e-9)
    # And the result should still be valid and not crash.
    assert 0.0 <= without_embed <= 1.0

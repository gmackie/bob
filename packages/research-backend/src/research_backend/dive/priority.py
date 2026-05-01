"""Priority scoring for the dive worker's BFS frontier.

The dive worker performs bounded breadth-first expansion over the Semantic
Scholar citation graph starting from a set of seed papers. At each step it
pops the paper with the highest *priority* — a weighted blend of several
signals — and fetches its references/citations.

This module holds the pure scoring primitives plus a composite ``priority``
function. Everything here is side-effect-free and works on plain dicts so the
BFS loop (Task 3.2) can keep its I/O concerns (S2 fetches, DB writes) cleanly
separated from scoring decisions.

Design notes
------------
* Each component returns a value normalized (or easily normalizable) to
  ``[0, 1]`` so the weighted sum in :func:`priority` is also bounded to
  ``[0, 1]``. Downstream consumers can sort directly without worrying about
  scale mismatches between signals.
* Weights live in :data:`FOCUS_WEIGHTS` as three presets (balanced / recent /
  foundational). Each preset sums to 1.0 — enforced by a unit test so we
  notice if someone tweaks one weight without adjusting another.
* Recency uses a linear 20-year decay: papers published exactly at
  ``reference_year`` score 1.0, papers 20+ years old score 0.0. A linear
  schedule is easy to reason about and avoids tuning an exponential half-life
  before we have real data. The horizon can be re-tuned once we see telemetry.
* Embedding similarity uses plain cosine and clamps to ``[0, 1]``. Zero
  vectors short-circuit to ``0.0`` so we never hit ``0/0`` NaNs — this is
  especially important because the S2 API occasionally returns all-zero
  embedding vectors for papers it could not embed.
* Citation overlap is computed against *any* seed — a paper cited by two
  different seeds is more interesting than a paper cited by one, so the
  overlap count is effectively the size of the intersection between the
  paper's references and the union of all seed references, counted per-paper
  ref (i.e. 2 refs of paper matching 2 different seeds → overlap=2).
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

__all__ = [
    "FOCUS_WEIGHTS",
    "citation_overlap",
    "embedding_sim",
    "influence_score",
    "priority",
    "recency_boost",
    "unseen_author_bonus",
]


# ---------------------------------------------------------------------------
# Focus presets — weights per component.
# ---------------------------------------------------------------------------

#: Weight presets keyed by focus mode. Each dict's values must sum to 1.0 so
#: the weighted blend in :func:`priority` stays in ``[0, 1]``.
FOCUS_WEIGHTS: dict[str, dict[str, float]] = {
    "balanced": {
        "overlap": 0.35,
        "influence": 0.25,
        "sim": 0.20,
        "recency": 0.15,
        "unseen_author": 0.05,
    },
    "recent": {
        "overlap": 0.25,
        "influence": 0.15,
        "sim": 0.15,
        "recency": 0.40,
        "unseen_author": 0.05,
    },
    "foundational": {
        "overlap": 0.30,
        "influence": 0.50,
        "sim": 0.15,
        "recency": 0.00,
        "unseen_author": 0.05,
    },
}


# ---------------------------------------------------------------------------
# Component scorers — each returns a raw (not necessarily normalized) signal.
# Normalization to [0, 1] happens inside :func:`priority` for the overlap
# component; the rest already return [0, 1].
# ---------------------------------------------------------------------------


def _ref_ids(paper: dict) -> set[str]:
    """Extract the paperIds of ``paper``'s references as a set.

    Missing / malformed entries are silently skipped so callers don't have to
    defensively validate every S2 response.
    """
    refs = paper.get("references") or []
    ids: set[str] = set()
    for ref in refs:
        if isinstance(ref, dict):
            pid = ref.get("paperId")
            if isinstance(pid, str) and pid:
                ids.add(pid)
    return ids


def citation_overlap(
    paper: dict,
    seeds: Iterable[dict],
    precomputed_seed_refs: set[str] | None = None,
) -> int:
    """Count references ``paper`` shares with the union of seed references.

    Each reference is counted at most once (set membership), even if multiple
    seeds reference it. This is the raw count — :func:`priority` normalizes it
    to ``[0, 1]`` before combining with the other signals.

    ``precomputed_seed_refs`` lets callers compute the seed-refs union once
    and pass it in. BFS does this so the union isn't rebuilt on every
    neighbor score. When unset, falls back to rebuilding from ``seeds``.
    """
    paper_refs = _ref_ids(paper)
    if not paper_refs:
        return 0
    if precomputed_seed_refs is not None:
        return len(paper_refs & precomputed_seed_refs)
    seed_refs: set[str] = set()
    for seed in seeds:
        seed_refs |= _ref_ids(seed)
    return len(paper_refs & seed_refs)


def influence_score(paper: dict) -> float:
    """Fraction of ``paper``'s citations that are marked "influential".

    Uses the S2-reported ``influentialCitationCount`` divided by
    ``citationCount`` (floored at 1 to avoid division by zero), clamped to
    ``[0, 1]``. Mirrors the normalization used during S2 ingest so the signal
    stays consistent across the pipeline.
    """
    influential = paper.get("influentialCitationCount")
    total = paper.get("citationCount")
    if not isinstance(influential, (int, float)) or influential <= 0:
        return 0.0
    denom = total if isinstance(total, (int, float)) and total > 0 else 1
    score = float(influential) / float(denom)
    if score < 0.0:
        return 0.0
    if score > 1.0:
        return 1.0
    return score


def recency_boost(year: int | None, reference_year: int = 2026) -> float:
    """Linear-decay recency score in ``[0, 1]``.

    * ``year == reference_year`` → ``1.0``
    * ``year <= reference_year - 20`` → ``0.0``
    * ``year is None`` → ``0.0`` (unknown publication date is treated as old)

    A linear decay is deliberately simple; we can swap in an exponential or
    a sigmoid later if telemetry shows the shape matters.
    """
    if year is None:
        return 0.0
    age = reference_year - int(year)
    if age <= 0:
        return 1.0
    if age >= 20:
        return 0.0
    return 1.0 - age / 20.0


def embedding_sim(
    a: list[float] | np.ndarray | None,
    b: list[float] | np.ndarray | None,
) -> float:
    """Cosine similarity between two vectors, clamped to ``[0, 1]``.

    Returns ``0.0`` when either input is missing or a zero vector; this
    avoids NaN poisoning in the weighted sum. Negative cosine values (two
    vectors pointing in opposite directions) are clamped up to 0, which is
    the right behavior for "how related is this paper to my focus" — anti-
    correlation shouldn't penalize below missing-data.
    """
    if a is None or b is None:
        return 0.0
    av = np.asarray(a, dtype=np.float64)
    bv = np.asarray(b, dtype=np.float64)
    if av.size == 0 or bv.size == 0:
        return 0.0
    if av.shape != bv.shape:
        return 0.0
    na = float(np.linalg.norm(av))
    nb = float(np.linalg.norm(bv))
    if na == 0.0 or nb == 0.0:
        return 0.0
    cos = float(np.dot(av, bv) / (na * nb))
    if cos < 0.0:
        return 0.0
    if cos > 1.0:
        return 1.0
    return cos


def _author_names(paper: dict) -> list[str]:
    """Extract normalized (lowercase, stripped) author names from ``paper``."""
    authors = paper.get("authors") or []
    names: list[str] = []
    for author in authors:
        if isinstance(author, dict):
            name = author.get("name")
        else:
            name = author
        if isinstance(name, str):
            norm = name.strip().lower()
            if norm:
                names.append(norm)
    return names


def unseen_author_bonus(paper: dict, seen_authors: set[str]) -> float:
    """Fraction of ``paper``'s authors we haven't seen yet, in ``[0, 1]``.

    * all authors new → ``1.0``
    * all authors known → ``0.0``
    * half and half → ``0.5``
    * no (usable) authors → ``0.0`` (treat missing metadata as "no bonus"
      rather than a free point)

    ``seen_authors`` must contain lowercased/stripped name strings; compare
    with :func:`_author_names` normalization.
    """
    names = _author_names(paper)
    if not names:
        return 0.0
    unseen = sum(1 for n in names if n not in seen_authors)
    return unseen / len(names)


# ---------------------------------------------------------------------------
# Composite priority.
# ---------------------------------------------------------------------------


# Minimum denominator used when normalizing the raw overlap count against the
# paper's own reference-list size. Prevents tiny-reference papers from
# dominating the frontier and avoids divide-by-zero when a paper has no
# references at all.
_MIN_REF_DENOM = 5


def priority(
    paper: dict,
    seeds: Iterable[dict],
    focus_embedding: np.ndarray | list[float] | None,
    seen_authors: set[str],
    focus: str = "balanced",
    reference_year: int = 2026,
    precomputed_seed_refs: set[str] | None = None,
) -> float:
    """Blended priority for BFS frontier selection, in ``[0, 1]``.

    Each component is normalized to ``[0, 1]`` and then weighted according to
    :data:`FOCUS_WEIGHTS[focus]`. An unknown ``focus`` silently falls back to
    ``"balanced"`` so a typo from the tool layer can't crash the worker.

    ``precomputed_seed_refs`` lets BFS pass the seed-refs union once so the
    inner loop doesn't rebuild it per neighbor.
    """
    # ``seeds`` is an Iterable — materialize once so we can both (a) pass it
    # to ``citation_overlap`` and (b) not care whether the caller handed us a
    # generator. Keeping the list local is cheap; typical seed sets are <25.
    # Skipped when ``precomputed_seed_refs`` is supplied (BFS path).
    seed_list: list[dict] = [] if precomputed_seed_refs is not None else list(seeds)

    weights = FOCUS_WEIGHTS.get(focus, FOCUS_WEIGHTS["balanced"])

    # --- overlap: normalize against paper's own ref count, floored. ---
    raw_overlap = citation_overlap(
        paper, seed_list, precomputed_seed_refs=precomputed_seed_refs
    )
    paper_ref_count = len(paper.get("references") or [])
    denom = max(paper_ref_count, _MIN_REF_DENOM)
    overlap_norm = raw_overlap / denom
    if overlap_norm > 1.0:
        overlap_norm = 1.0

    # --- influence: already [0, 1]. ---
    influence_norm = influence_score(paper)

    # --- similarity: requires both focus embedding and paper embedding. ---
    paper_embedding = paper.get("embedding")
    if isinstance(paper_embedding, dict):
        # S2 returns ``{"model": "...", "vector": [...]}`` for embeddings.
        paper_embedding = paper_embedding.get("vector")
    if focus_embedding is None or paper_embedding is None:
        sim_norm = 0.0
    else:
        sim_norm = embedding_sim(focus_embedding, paper_embedding)

    # --- recency: already [0, 1]. ---
    recency_norm = recency_boost(paper.get("year"), reference_year=reference_year)

    # --- unseen-author bonus: already [0, 1]. ---
    unseen_norm = unseen_author_bonus(paper, seen_authors)

    score = (
        weights["overlap"] * overlap_norm
        + weights["influence"] * influence_norm
        + weights["sim"] * sim_norm
        + weights["recency"] * recency_norm
        + weights["unseen_author"] * unseen_norm
    )
    # Guard against tiny floating-point overshoot so callers can trust [0, 1].
    if score < 0.0:
        return 0.0
    if score > 1.0:
        return 1.0
    return score

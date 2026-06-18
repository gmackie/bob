"""LLM summarization of a completed dive.

Task 3.4 of the academic-research-buddy plan. Given a finished dive
(seed papers, visited papers with metadata, the clustering result from
:func:`research_backend.clustering.cluster_exploration`, and the focus
preset the user chose), produce a short markdown summary suitable for
display in the dashboard and for storing in
``graph_exploration.summary_md``.

Design notes
------------
* **Single round trip, cheap model.** The summarizer is called exactly
  once per dive. The default model is ``gpt-4o-mini`` (overridable via
  the ``SUMMARIZE_MODEL`` env var) because this is a short, structured
  write-up — nothing justifies a frontier model. Failures propagate so
  the orchestrator (Task 3.5) can write ``status='done'`` with
  ``summary_md=NULL`` rather than masking the failure here.
* **Injectable LLM.** :func:`summarize_dive` accepts an ``llm`` callable
  so tests never hit a real provider. The callable receives the system
  prompt, user prompt, and model name as kwargs and returns the
  generated text (sync *or* async; both are awaited-if-awaitable). When
  ``llm`` is ``None`` we build a default that dispatches to
  :mod:`research_backend.llm` via :func:`get_provider`, honouring the
  ``ANALYSIS_PROVIDER`` env var the rest of the backend already uses.
  The sync ``provider.generate`` call is offloaded via
  :func:`asyncio.to_thread` so the FastAPI event loop isn't blocked.
* **Deterministic prompt construction.** :func:`build_prompt` is pure
  string manipulation — no I/O, no LLM — so every unit test can assert
  on the exact rendered text. All prompt sections are always emitted
  (seeds, clusters or fallback, focus, top visited) so structural tests
  are easy to write.
* **Defensive cluster rendering.** When clustering is unavailable (0
  clusters, or an empty dict) we drop in an explicit note and fall back
  to listing the top visited papers. That way the LLM still has signal
  even for tiny dives where HDBSCAN bails out.
* **Field tolerance.** Paper dicts carry whatever fields the caller
  chose to serialize. :func:`_format_paper_line` uses ``.get`` with
  sane fallbacks so a paper missing e.g. ``authors`` still renders a
  readable line instead of throwing ``KeyError``.
"""

from __future__ import annotations

import asyncio
import inspect
import os
from collections.abc import Callable
from typing import Any

__all__ = [
    "SUMMARIZE_SYSTEM_PROMPT",
    "build_prompt",
    "summarize_dive",
]


# The system prompt is intentionally verbose and contains a few long lines —
# line breaks inside bullets would either reflow awkwardly in the LLM's view
# or change the semantics of the instructions. ruff E501 is suppressed for
# this block alone.
SUMMARIZE_SYSTEM_PROMPT = (
    "You are an academic research assistant writing a short markdown summary of a\n"
    "research dive. A dive starts from seed papers, explores the citation graph,\n"
    "and groups visited papers into clusters.\n"
    "\n"
    "Your summary (max 500 words, markdown) should contain:\n"
    "- A 2-3 sentence TL;DR of what the dive found.\n"
    "- A \"Key clusters\" section with one heading per cluster and the top 3-5 papers "
    "per cluster (title, author, year, 1-line why-it-matters).\n"
    "- A \"Seeds and their neighborhood\" paragraph describing how directly the "
    "clusters connect to the seed papers.\n"
    "- A \"Suggested next questions\" bullet list (3-5 items) the researcher might "
    "ask next.\n"
    "\n"
    "Be concrete. Use the paper titles and findings. Do not invent findings not\n"
    "present in the input data. If embeddings or clusters are absent, say so and\n"
    "summarize the visited set as a flat list.\n"
)


_DEFAULT_MODEL = "gpt-4o-mini"
_MAX_FLAT_VISITED = 15


def _format_authors(authors: Any) -> str:
    """Render an authors field (list[str] / list[dict] / str / None) compactly."""
    if not authors:
        return "Unknown"
    if isinstance(authors, str):
        return authors
    if isinstance(authors, list):
        names: list[str] = []
        for a in authors:
            if isinstance(a, str):
                names.append(a)
            elif isinstance(a, dict):
                name = a.get("name") or a.get("displayName") or ""
                if name:
                    names.append(name)
        if not names:
            return "Unknown"
        if len(names) == 1:
            return names[0]
        if len(names) == 2:
            return f"{names[0]} & {names[1]}"
        return f"{names[0]} et al."
    return str(authors)


def _why_it_matters(paper: dict) -> str:
    """Return a short proxy signal explaining why a paper stands out.

    Priority order (first match wins):
    1. Explicit ``why`` field on the paper (from caller).
    2. High influence score (>= 0.3 on the normalized scale).
    3. High raw citation count (>= 500 is "widely cited").
    4. Recency (published in or after ``reference_year - 2``).
    5. Generic fallback.
    """
    why = paper.get("why") or paper.get("why_it_matters")
    if why:
        return str(why)
    influence = paper.get("influence_score")
    try:
        if influence is not None and float(influence) >= 0.3:
            return f"high influence (score={float(influence):.2f})"
    except (TypeError, ValueError):
        pass
    citations = paper.get("citationCount") or paper.get("citation_count")
    try:
        if citations is not None and int(citations) >= 500:
            return f"widely cited ({int(citations)} citations)"
    except (TypeError, ValueError):
        pass
    year = paper.get("year")
    try:
        if year is not None and int(year) >= 2023:
            return f"recent ({int(year)})"
    except (TypeError, ValueError):
        pass
    return "surfaced via citation graph expansion"


def _format_paper_line(paper: dict) -> str:
    """Render a single paper as a bullet line.

    Format: ``- "Title" — Authors (Year) — why-it-matters``. Missing
    fields fall back to stable placeholders so the line is always
    syntactically well-formed markdown.
    """
    title = paper.get("title") or "(untitled)"
    authors = _format_authors(paper.get("authors"))
    year = paper.get("year") or "n.d."
    why = _why_it_matters(paper)
    return f'- "{title}" — {authors} ({year}) — {why}'


def _render_seeds(seeds: list[dict]) -> str:
    if not seeds:
        return "(no seeds provided)"
    lines = [_format_paper_line(s) for s in seeds]
    return "\n".join(lines)


def _render_clusters(clusters: dict, visited: list[dict]) -> str:
    """Render the clusters section.

    When ``clusters`` is missing, empty, or has ``n_clusters == 0`` we
    emit a fallback note and a flat list of the top ``_MAX_FLAT_VISITED``
    visited papers by influence score. The LLM is explicitly told
    clustering was unavailable so it doesn't fabricate cluster names.
    """
    n_clusters = 0
    cluster_list: list[dict] = []
    if isinstance(clusters, dict):
        n_clusters = int(clusters.get("n_clusters") or 0)
        raw_list = clusters.get("clusters") or []
        if isinstance(raw_list, list):
            cluster_list = [c for c in raw_list if isinstance(c, dict)]

    if n_clusters == 0 or not cluster_list:
        sorted_visited = sorted(
            (v for v in visited if isinstance(v, dict)),
            key=lambda v: -(float(v.get("influence_score") or 0.0)),
        )
        flat = sorted_visited[:_MAX_FLAT_VISITED]
        body = "\n".join(_format_paper_line(v) for v in flat) if flat else "(no visited papers)"
        return (
            "(clustering unavailable — flat list follows)\n"
            f"{body}"
        )

    parts: list[str] = []
    for cluster in cluster_list:
        label = cluster.get("label") or cluster.get("cluster_id") or "?"
        size = cluster.get("size")
        heading = f"### Cluster {label}"
        if size is not None:
            heading += f" (n={size})"
        parts.append(heading)
        top_papers = cluster.get("top_papers") or []
        rendered_any = False
        for paper in top_papers:
            if isinstance(paper, dict):
                parts.append(_format_paper_line(paper))
                rendered_any = True
        if not rendered_any:
            parts.append("- (no paper metadata available for this cluster)")
    return "\n".join(parts)


def build_prompt(
    *,
    seeds: list[dict],
    visited: list[dict],
    clusters: dict,
    focus: str,
) -> str:
    """Build the user message for the LLM call.

    Pure string manipulation so the whole function is unit-testable
    without an LLM. Sections always appear in the same order so
    structural assertions (``"Focus:" in prompt``, etc.) stay stable.
    """
    seed_count = len(seeds)
    visited_count = len(visited)
    clusters = clusters or {}

    seeds_section = _render_seeds(seeds)
    clusters_section = _render_clusters(clusters, visited)

    return (
        f"Focus: {focus}\n"
        f"Seed count: {seed_count}\n"
        f"Visited count: {visited_count}\n"
        "\n"
        "## Seeds\n"
        f"{seeds_section}\n"
        "\n"
        "## Clusters\n"
        f"{clusters_section}\n"
        "\n"
        "Write the markdown summary now, following the format described in the system prompt."
    )


def _default_llm_factory() -> Callable[..., Any]:
    """Build an ``llm`` callable backed by the normal provider stack.

    Resolves the provider at call time (not at import time) so tests
    that set env vars before invoking ``summarize_dive`` see a fresh
    configuration. The returned callable is ``async`` so it composes
    cleanly with the awaitable dispatch in :func:`summarize_dive`.
    """
    from research_backend.llm import get_provider

    async def _llm(*, system: str, prompt: str, model: str | None = None, **_: Any) -> str:
        # The existing provider config is read from env vars the rest of
        # the backend already uses; we override the model if the caller
        # supplied one.
        provider_type = os.environ.get("ANALYSIS_PROVIDER", "codex_app_server")
        config: dict[str, str] = {"default": provider_type}
        if model:
            config["model"] = model
        provider = get_provider(config)
        return await asyncio.to_thread(provider.generate, prompt, system=system)

    return _llm


async def summarize_dive(
    *,
    seeds: list[dict],
    visited: list[dict],
    clusters: dict,
    focus: str = "balanced",
    llm: Callable[..., Any] | None = None,
    model: str | None = None,
) -> str:
    """Produce a markdown summary of a completed dive.

    Parameters
    ----------
    seeds:
        Seed papers. Each dict should at minimum carry ``title`` — other
        fields (``authors``, ``year``, ``source_id``, ``s2_paper_id``)
        are used when present.
    visited:
        All papers visited during the dive, each enriched with
        ``influence_score`` so we can rank the flat fallback list.
    clusters:
        Output of :func:`research_backend.clustering.cluster_exploration`,
        optionally enriched by the orchestrator so each ``top_papers``
        entry carries full metadata (title / authors / year) rather than
        just the source id.
    focus:
        One of ``balanced`` / ``recent`` / ``foundational`` — passed
        through so the LLM can tailor the tone.
    llm:
        Dependency-injected LLM callable for testing. Signature:
        ``llm(*, system: str, prompt: str, model: str) -> str | Awaitable[str]``.
        When ``None`` the default provider stack is used.
    model:
        Optional model override. Defaults to the ``SUMMARIZE_MODEL`` env
        var, falling back to ``gpt-4o-mini``. Explicitly passed into the
        llm callable so tests can assert it.

    Returns
    -------
    str
        The assistant's response text, unmodified.

    Raises
    ------
    Exception
        Any exception from the llm callable propagates — the
        orchestrator decides whether to record it as an error.
    """
    prompt = build_prompt(
        seeds=seeds,
        visited=visited,
        clusters=clusters,
        focus=focus,
    )
    chosen_model = model or os.environ.get("SUMMARIZE_MODEL") or _DEFAULT_MODEL
    call = llm if llm is not None else _default_llm_factory()
    result = call(
        system=SUMMARIZE_SYSTEM_PROMPT,
        prompt=prompt,
        model=chosen_model,
    )
    if inspect.isawaitable(result):
        result = await result
    return result

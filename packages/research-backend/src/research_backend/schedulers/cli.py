"""CLI entry points for buddy scheduled ticks.

Usage
-----
::

    python -m research_backend.schedulers.cli standing-interests \\
        [--schema research_vault] [--batch-size 10] [--json]

    python -m research_backend.schedulers.cli synergy \\
        [--schema research_vault] [--thread-limit 50] [--json]

Each subcommand constructs a session factory from the configured
``DATABASE_URL``, invokes the matching scheduler ``tick`` once, and
prints a summary. ``--json`` flips output to a compact JSON line for
systemd-timer log ingestion.

LLM + embedding wiring for ``synergy``
--------------------------------------
``llm_summarize`` is a thin wrapper around the provider returned by
:func:`research_backend.llm.get_provider` (the same stack used elsewhere
in the backend).

``embed_text`` delegates to Ollama (``nomic-embed-text`` by default),
using the ``OLLAMA_BASE_URL`` and ``OLLAMA_EMBEDDING_MODEL`` settings
from :class:`~research_backend.config.Settings`.

Exit codes
----------
* 0 — tick completed (even with per-interest soft errors the tick
  surfaced in its return value).
* 1 — an unhandled exception escaped the tick; traceback is logged to
  stderr.
* argparse-native non-zero — unknown subcommand / bad flags.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import traceback
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------


def _build_session_factory(database_url: str | None = None) -> Callable[[], Any]:
    """Build a zero-arg session factory (context manager) from DATABASE_URL.

    The scheduler ``tick`` functions call the factory per unit of work so
    failures don't poison neighbouring work. We re-use a single engine to
    avoid re-opening a connection pool on every call.
    """
    from sqlmodel import Session, create_engine

    url = database_url or os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set — cannot build a session factory for the buddy tick."
        )
    engine = create_engine(url, echo=False)

    @contextmanager
    def factory() -> Iterator[Any]:
        with Session(engine) as session:
            yield session

    return factory


# ---------------------------------------------------------------------------
# LLM + embedding wiring for the synergy tick
# ---------------------------------------------------------------------------


def _build_llm_summarize() -> Callable[..., str]:
    """Return an ``llm_summarize(prior_summary, turns, compact) -> str`` callable.

    Delegates to :func:`research_backend.llm.get_provider`, using the
    ``ANALYSIS_PROVIDER`` env var just like the rest of the backend.
    """
    from research_backend.llm import get_provider

    provider_type = os.environ.get("ANALYSIS_PROVIDER", "codex_app_server")
    provider = get_provider({"default": provider_type})

    system = (
        "You maintain a rolling summary of a research conversation thread. "
        "Given the prior summary and recent turns, produce an updated, "
        "concise, information-dense summary (markdown). When `compact=true` "
        "the prior summary overflowed — shrink it aggressively while "
        "preserving key facts, decisions, and open questions."
    )

    def _summarize(
        *,
        prior_summary: str,
        turns: list[str],
        compact: bool,
    ) -> str:
        turns_block = "\n\n".join(f"- {t}" for t in turns) if turns else "(no new turns)"
        prompt = (
            f"Prior summary:\n{prior_summary or '(empty)'}\n\n"
            f"Recent turns:\n{turns_block}\n\n"
            f"compact={str(compact).lower()}"
        )
        return provider.generate(prompt, system=system)

    return _summarize


def _build_embed_text() -> tuple[Callable[[str], list[float] | None], str]:
    """Return an ``embed_text`` callable + model label using Ollama."""
    from research_backend.config import get_settings
    from research_backend.embeddings import _ollama_embed_single

    settings = get_settings()
    base_url = settings.ollama_base_url
    model = settings.ollama_embedding_model

    def _embed(text: str) -> list[float] | None:
        vec = _ollama_embed_single(base_url, model, text)
        if vec is None:
            return None
        return vec.tolist()

    return _embed, model


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def _format_standing_interests(result: dict[str, Any]) -> str:
    disabled = result.get("disabled") or []
    return (
        "standing-interests tick complete\n"
        f"  processed:      {result.get('processed', 0)}\n"
        f"  hits_inserted:  {result.get('hits_inserted', 0)}\n"
        f"  errors:         {result.get('errors', 0)}\n"
        f"  disabled:       {list(disabled)}"
    )


def _format_synergy(result: dict[str, Any]) -> str:
    return (
        "synergy tick complete\n"
        f"  summaries_refreshed:     {result.get('summaries_refreshed', 0)}\n"
        f"  notes_backfilled:        {result.get('notes_backfilled', 0)}\n"
        f"  topic_edges:             {result.get('topic_edges', 0)}\n"
        f"  citation_edges:          {result.get('citation_edges', 0)}\n"
        f"  entity_edges:            {result.get('entity_edges', 0)}\n"
        f"  dead_interests_flagged:  {result.get('dead_interests_flagged', 0)}"
    )


def _format_backfill(result: dict[str, Any]) -> str:
    return (
        "backfill-embeddings complete\n"
        f"  total:   {result.get('total', 0)}\n"
        f"  updated: {result.get('updated', 0)}\n"
        f"  errors:  {result.get('errors', 0)}"
    )


def _emit(result: dict[str, Any], *, as_json: bool, human: Callable[[dict[str, Any]], str]) -> None:
    if as_json:
        # ``default=str`` so UUIDs / datetimes survive serialization.
        sys.stdout.write(json.dumps(result, separators=(",", ":"), default=str) + "\n")
    else:
        sys.stdout.write(human(result) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Subcommand runners
# ---------------------------------------------------------------------------


def _run_standing_interests(args: argparse.Namespace) -> int:
    from research_backend.schedulers import standing_interests

    session_factory = _build_session_factory()
    result = standing_interests.tick(
        session_factory,
        batch_size=args.batch_size,
        schema=args.schema,
    )
    _emit(result, as_json=args.json, human=_format_standing_interests)
    return 0


def _run_synergy(args: argparse.Namespace) -> int:
    from research_backend.schedulers import thread_synergy

    session_factory = _build_session_factory()
    llm_summarize = _build_llm_summarize()
    embed_text, embedding_model = _build_embed_text()
    result = thread_synergy.tick(
        session_factory,
        thread_limit=args.thread_limit,
        schema=args.schema,
        llm_summarize=llm_summarize,
        embed_text=embed_text,
        embedding_model=embedding_model,
    )
    _emit(result, as_json=args.json, human=_format_synergy)
    return 0


def _run_backfill_embeddings(args: argparse.Namespace) -> int:
    """Re-embed thread_memory rows where embedding IS NULL."""
    import numpy as np
    from sqlmodel import text

    session_factory = _build_session_factory()
    embed_text, model_label = _build_embed_text()

    with session_factory() as session:
        rows = session.execute(
            text(
                "SELECT thread_id, rolling_summary_md FROM thread_memory "
                "WHERE embedding IS NULL AND rolling_summary_md IS NOT NULL"
            )
        ).fetchall()

    total = len(rows)
    updated = 0
    errors = 0

    for i, row in enumerate(rows):
        thread_id, summary = row[0], row[1]
        logger.info("backfill %d/%d: thread %s", i + 1, total, thread_id)

        vec = embed_text(summary)
        if vec is None:
            logger.warning("embed returned None for thread %s", thread_id)
            errors += 1
            continue

        encoded = np.asarray(vec, dtype=np.float32).tobytes()
        with session_factory() as session:
            session.execute(
                text(
                    "UPDATE thread_memory "
                    "SET embedding = :emb, embedding_model = :model, updated_at = now() "
                    "WHERE thread_id = :tid"
                ),
                {"emb": encoded, "model": model_label, "tid": thread_id},
            )
            session.commit()
        updated += 1

    result = {"total": total, "updated": updated, "errors": errors}
    _emit(result, as_json=args.json, human=_format_backfill)
    return 0


# ---------------------------------------------------------------------------
# Argparse plumbing
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="buddy-tick",
        description="One-shot CLI for buddy scheduled ticks.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    si = sub.add_parser(
        "standing-interests",
        help="Run one standing_interests tick (OpenAlex polls → findings_inbox).",
    )
    si.add_argument("--schema", default="research_vault")
    si.add_argument("--batch-size", type=int, default=10)
    si.add_argument("--json", action="store_true", help="Emit compact JSON to stdout.")
    si.set_defaults(func=_run_standing_interests)

    sy = sub.add_parser(
        "synergy",
        help="Run one thread_synergy tick (rolling summaries + thread_link edges).",
    )
    sy.add_argument("--schema", default="research_vault")
    sy.add_argument("--thread-limit", type=int, default=50)
    sy.add_argument("--json", action="store_true", help="Emit compact JSON to stdout.")
    sy.set_defaults(func=_run_synergy)

    bf = sub.add_parser(
        "backfill-embeddings",
        help="Re-embed thread_memory rows where embedding IS NULL.",
    )
    bf.add_argument("--json", action="store_true", help="Emit compact JSON to stdout.")
    bf.set_defaults(func=_run_backfill_embeddings)

    return parser


def main(argv: list[str] | None = None) -> int:
    # Configure logging to stderr once; idempotent across re-entry in tests.
    logging.basicConfig(
        level=os.environ.get("BUDDY_TICK_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except SystemExit:
        # Let argparse's own exits through unchanged.
        raise
    except Exception:  # noqa: BLE001
        logger.error("buddy-tick %s failed with unhandled exception", args.command)
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())

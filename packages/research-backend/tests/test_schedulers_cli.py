"""Tests for :mod:`research_backend.schedulers.cli`.

All tests stub the tick functions and the session-factory builder so no
real DB, LLM, or HTTP call is attempted. ``capsys`` captures stdout /
stderr; ``monkeypatch`` swaps the tick implementations at module scope.
"""

from __future__ import annotations

import json

import pytest

from research_backend.schedulers import cli as cli_mod

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _FakeFactory:
    """Marker object; the CLI never calls it because tick is stubbed."""

    def __call__(self):  # pragma: no cover - never invoked
        raise AssertionError("session factory should not be invoked under test")


def _stub_factory_builder(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prevent the CLI from touching ``DATABASE_URL`` or SQLAlchemy."""
    monkeypatch.setattr(cli_mod, "_build_session_factory", lambda *a, **kw: _FakeFactory())


def _stub_synergy_wiring(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace the real LLM / embed builders with lightweight stand-ins."""
    monkeypatch.setattr(
        cli_mod,
        "_build_llm_summarize",
        lambda: (lambda *, prior_summary, turns, compact: "stub"),
    )
    monkeypatch.setattr(cli_mod, "_build_embed_text", lambda: (lambda _t: [0.0]))


# ---------------------------------------------------------------------------
# standing-interests
# ---------------------------------------------------------------------------


def test_standing_interests_json_output(monkeypatch, capsys):
    _stub_factory_builder(monkeypatch)

    captured_kwargs: dict = {}

    def fake_tick(session_factory, *, batch_size=10, schema="research_vault"):
        captured_kwargs["session_factory"] = session_factory
        captured_kwargs["batch_size"] = batch_size
        captured_kwargs["schema"] = schema
        return {
            "processed": 3,
            "hits_inserted": 7,
            "errors": 0,
            "disabled": [],
        }

    from research_backend.schedulers import standing_interests

    monkeypatch.setattr(standing_interests, "tick", fake_tick)

    exit_code = cli_mod.main(["standing-interests", "--json"])
    assert exit_code == 0

    out = capsys.readouterr().out.strip()
    payload = json.loads(out)
    assert payload == {
        "processed": 3,
        "hits_inserted": 7,
        "errors": 0,
        "disabled": [],
    }
    assert captured_kwargs["batch_size"] == 10
    assert captured_kwargs["schema"] == "research_vault"
    assert isinstance(captured_kwargs["session_factory"], _FakeFactory)


def test_standing_interests_human_output(monkeypatch, capsys):
    _stub_factory_builder(monkeypatch)

    def fake_tick(session_factory, *, batch_size=10, schema="research_vault"):
        return {
            "processed": 2,
            "hits_inserted": 5,
            "errors": 1,
            "disabled": ["abc"],
        }

    from research_backend.schedulers import standing_interests

    monkeypatch.setattr(standing_interests, "tick", fake_tick)

    exit_code = cli_mod.main(["standing-interests"])
    assert exit_code == 0

    out = capsys.readouterr().out
    assert "processed" in out
    assert "hits_inserted" in out
    assert "errors" in out
    # Human format should *not* be JSON.
    with pytest.raises(json.JSONDecodeError):
        json.loads(out)


def test_standing_interests_forwards_flags(monkeypatch, capsys):
    _stub_factory_builder(monkeypatch)

    seen: dict = {}

    def fake_tick(session_factory, *, batch_size=10, schema="research_vault"):
        seen["batch_size"] = batch_size
        seen["schema"] = schema
        return {"processed": 0, "hits_inserted": 0, "errors": 0, "disabled": []}

    from research_backend.schedulers import standing_interests

    monkeypatch.setattr(standing_interests, "tick", fake_tick)

    exit_code = cli_mod.main(
        ["standing-interests", "--batch-size", "25", "--schema", "personal_vault", "--json"]
    )
    assert exit_code == 0
    assert seen == {"batch_size": 25, "schema": "personal_vault"}


# ---------------------------------------------------------------------------
# synergy
# ---------------------------------------------------------------------------


def test_synergy_json_output(monkeypatch, capsys):
    _stub_factory_builder(monkeypatch)
    _stub_synergy_wiring(monkeypatch)

    captured_kwargs: dict = {}

    def fake_tick(session_factory, **kwargs):
        captured_kwargs.update(kwargs)
        return {
            "summaries_refreshed": 2,
            "topic_edges": 1,
            "citation_edges": 0,
            "dead_interests_flagged": 1,
        }

    from research_backend.schedulers import thread_synergy

    monkeypatch.setattr(thread_synergy, "tick", fake_tick)

    exit_code = cli_mod.main(["synergy", "--json"])
    assert exit_code == 0

    payload = json.loads(capsys.readouterr().out.strip())
    assert payload == {
        "summaries_refreshed": 2,
        "topic_edges": 1,
        "citation_edges": 0,
        "dead_interests_flagged": 1,
    }
    assert captured_kwargs["thread_limit"] == 50
    assert captured_kwargs["schema"] == "research_vault"
    # Wiring: CLI should have passed injected callables.
    assert callable(captured_kwargs["llm_summarize"])
    assert callable(captured_kwargs["embed_text"])


def test_synergy_human_output(monkeypatch, capsys):
    _stub_factory_builder(monkeypatch)
    _stub_synergy_wiring(monkeypatch)

    def fake_tick(session_factory, **kwargs):
        return {
            "summaries_refreshed": 4,
            "topic_edges": 2,
            "citation_edges": 3,
            "dead_interests_flagged": 0,
        }

    from research_backend.schedulers import thread_synergy

    monkeypatch.setattr(thread_synergy, "tick", fake_tick)

    exit_code = cli_mod.main(["synergy"])
    assert exit_code == 0

    out = capsys.readouterr().out
    assert "summaries_refreshed" in out
    assert "topic_edges" in out
    assert "citation_edges" in out


def test_synergy_forwards_flags(monkeypatch, capsys):
    _stub_factory_builder(monkeypatch)
    _stub_synergy_wiring(monkeypatch)

    seen: dict = {}

    def fake_tick(session_factory, **kwargs):
        seen.update(kwargs)
        return {
            "summaries_refreshed": 0,
            "topic_edges": 0,
            "citation_edges": 0,
            "dead_interests_flagged": 0,
        }

    from research_backend.schedulers import thread_synergy

    monkeypatch.setattr(thread_synergy, "tick", fake_tick)

    exit_code = cli_mod.main(
        ["synergy", "--thread-limit", "7", "--schema", "personal_vault", "--json"]
    )
    assert exit_code == 0
    assert seen["thread_limit"] == 7
    assert seen["schema"] == "personal_vault"


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_help_exits_zero(capsys):
    with pytest.raises(SystemExit) as exc_info:
        cli_mod.main(["--help"])
    # argparse --help always exits 0.
    assert exc_info.value.code == 0
    out = capsys.readouterr().out
    assert "standing-interests" in out
    assert "synergy" in out


def test_unknown_subcommand_exits_nonzero(capsys):
    with pytest.raises(SystemExit) as exc_info:
        cli_mod.main(["nope"])
    # argparse typically exits 2 for usage errors; any non-zero is fine.
    assert exc_info.value.code != 0


def test_tick_exception_returns_one(monkeypatch, capsys):
    _stub_factory_builder(monkeypatch)

    def boom(session_factory, *, batch_size=10, schema="research_vault"):
        raise RuntimeError("simulated explosion")

    from research_backend.schedulers import standing_interests

    monkeypatch.setattr(standing_interests, "tick", boom)

    exit_code = cli_mod.main(["standing-interests"])
    assert exit_code == 1

    captured = capsys.readouterr()
    err = captured.err
    # Traceback on stderr, not stdout.
    assert "simulated explosion" in err
    assert "Traceback" in err
    assert "simulated explosion" not in captured.out


def test_embed_text_warns_once_and_returns_none(monkeypatch, caplog):
    """The placeholder embedder returns ``None`` (not a zero-vec) and warns once.

    Returning ``None`` lets the synergy tick write
    ``thread_memory.embedding = NULL`` + ``embedding_model = NULL`` so a
    future "re-embed the placeholders" sweep can find exactly the rows
    that need a real vector. A zero-vec would look like a real embedding
    and silently poison cos-similarity comparisons once a real embedder
    lands.
    """
    # Reset the module-level latch — other tests may have tripped it.
    monkeypatch.setattr(cli_mod, "_EMBED_WARNING_EMITTED", False)
    embedder = cli_mod._build_embed_text()

    with caplog.at_level("WARNING", logger=cli_mod.logger.name):
        v1 = embedder("hello world")
        v2 = embedder("another string")

    assert v1 is None
    assert v2 is None
    # Warning emitted exactly once regardless of call count.
    warning_count = sum(
        1 for r in caplog.records if "placeholder" in r.getMessage().lower()
    )
    assert warning_count == 1

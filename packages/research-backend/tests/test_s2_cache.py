"""Tests for ``research_backend.s2.cache``.

* Unit tests (always run): exercise ``cache_key`` stability and properties.
* Integration tests (DB-gated): exercise ``S2Cache.get/set/invalidate`` against
  a live Postgres referenced by ``DATABASE_URL``. Gated via ``skip_no_db`` so
  CI/dev machines without a DB still get the unit coverage.

The integration fixture connects through SQLModel's ``Session`` (the idiom
used in ``research_backend.db``) and uniquifies keys per test so concurrent
runs do not collide. Cleanup is via ``invalidate`` in a ``try/finally``.
"""

from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from research_backend.s2.cache import S2Cache, cache_key

# ---------------------------------------------------------------------------
# Unit tests — always run, no DB required
# ---------------------------------------------------------------------------


def test_cache_key_stable_across_param_order():
    k1 = cache_key("/paper/search", {"query": "sleep", "limit": 10})
    k2 = cache_key("/paper/search", {"limit": 10, "query": "sleep"})
    assert k1 == k2


def test_cache_key_differs_on_endpoint():
    params = {"query": "sleep"}
    assert cache_key("/paper/search", params) != cache_key("/paper/bulk", params)


def test_cache_key_differs_on_params():
    assert cache_key("/paper/search", {"query": "sleep"}) != cache_key(
        "/paper/search", {"query": "wake"}
    )


def test_cache_key_handles_nested_dict():
    k1 = cache_key("/x", {"a": {"x": 1}})
    k2 = cache_key("/x", {"a": {"x": 2}})
    assert k1 != k2
    # Nested key order should not matter either.
    k3 = cache_key("/x", {"a": {"x": 1, "y": 2}})
    k4 = cache_key("/x", {"a": {"y": 2, "x": 1}})
    assert k3 == k4


def test_cache_key_handles_datetime_param():
    dt = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    # Must not raise, and must produce a deterministic key for the same input.
    k1 = cache_key("/x", {"since": dt})
    k2 = cache_key("/x", {"since": dt})
    assert k1 == k2
    assert len(k1) == 40


def test_cache_key_length_is_40():
    key = cache_key("/paper/search", {"query": "anything"})
    assert len(key) == 40
    # Hex characters only.
    int(key, 16)


# ---------------------------------------------------------------------------
# Integration tests — require DATABASE_URL + research_vault.s2_cache to exist
# ---------------------------------------------------------------------------

skip_no_db = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"),
    reason="integration test requires DATABASE_URL",
)


@pytest.fixture
def s2_cache_fixture():
    """Yield a ``(S2Cache, session_factory)`` pair bound to ``research_vault``.

    Uses SQLModel's ``Session`` + an engine derived from ``DATABASE_URL``.
    Matches ``research_backend.db.build_engine`` at call-site but avoids the
    Settings import so the fixture is usable even if env vars required by
    Settings aren't set (only ``DATABASE_URL`` is needed here).
    """
    from sqlmodel import Session, create_engine

    url = os.environ["DATABASE_URL"]
    engine = create_engine(url, echo=False)

    def session_factory():
        return Session(engine)

    cache = S2Cache(session_factory, ttl_seconds=60, schema="research_vault")
    try:
        yield cache, session_factory
    finally:
        engine.dispose()


@skip_no_db
def test_set_then_get_roundtrip(s2_cache_fixture):
    cache, _ = s2_cache_fixture
    key = f"test-roundtrip-{uuid.uuid4().hex}"
    try:
        cache.set(key, {"result": 1, "nested": {"a": [1, 2, 3]}})
        got = cache.get(key)
        assert got == {"result": 1, "nested": {"a": [1, 2, 3]}}
    finally:
        cache.invalidate(key)


@skip_no_db
def test_get_miss_returns_none(s2_cache_fixture):
    cache, _ = s2_cache_fixture
    assert cache.get(f"definitely-missing-{uuid.uuid4().hex}") is None


@skip_no_db
def test_expired_entry_returns_none(s2_cache_fixture):
    cache, session_factory = s2_cache_fixture
    key = f"test-expired-{uuid.uuid4().hex}"
    try:
        # Insert directly with expires_at in the past to avoid relying on
        # sleeping or ttl_override=0 racing the clock.
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        with session_factory() as s:
            s.execute(
                text(
                    "INSERT INTO research_vault.s2_cache "
                    "(key, response_json, fetched_at, expires_at) "
                    "VALUES (:k, CAST(:v AS jsonb), NOW(), :e)"
                ),
                {"k": key, "v": '{"x": 1}', "e": past},
            )
            s.commit()
        assert cache.get(key) is None
    finally:
        cache.invalidate(key)


@skip_no_db
def test_set_upsert_refreshes_ttl_and_value(s2_cache_fixture):
    cache, session_factory = s2_cache_fixture
    key = f"test-upsert-{uuid.uuid4().hex}"
    try:
        cache.set(key, {"v": 1}, ttl_override=30)
        with session_factory() as s:
            row1 = s.execute(
                text(
                    "SELECT response_json, expires_at FROM research_vault.s2_cache "
                    "WHERE key = :k"
                ),
                {"k": key},
            ).first()
        assert row1 is not None
        assert row1.response_json == {"v": 1}
        first_expires = row1.expires_at

        # Ensure a measurable gap, then upsert.
        time.sleep(0.05)
        cache.set(key, {"v": 2}, ttl_override=120)

        with session_factory() as s:
            row2 = s.execute(
                text(
                    "SELECT response_json, expires_at FROM research_vault.s2_cache "
                    "WHERE key = :k"
                ),
                {"k": key},
            ).first()
        assert row2 is not None
        assert row2.response_json == {"v": 2}
        assert row2.expires_at > first_expires
    finally:
        cache.invalidate(key)


@skip_no_db
def test_invalidate_removes_entry(s2_cache_fixture):
    cache, _ = s2_cache_fixture
    key = f"test-invalidate-{uuid.uuid4().hex}"
    cache.set(key, {"gone": True})
    assert cache.get(key) == {"gone": True}
    cache.invalidate(key)
    assert cache.get(key) is None

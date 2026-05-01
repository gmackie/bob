"""Tests for ``research_backend.s2.client.S2Client``.

All outbound HTTP is mocked via ``unittest.mock.AsyncMock``; the cache is a
``MagicMock``. Backoff is shrunk via the ``_backoff_base`` kwarg on the
client so the retry tests run in sub-second wall time.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from research_backend.s2.client import S2Client
from research_backend.s2.rate_limit import TokenBucket

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_response(status_code: int, json_body: dict | None = None) -> MagicMock:
    """Build a mock response shaped like ``httpx.Response``."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body or {}
    # A lightweight stand-in for request so HTTPStatusError can be constructed
    # if the client code paths touch it.
    resp.request = MagicMock(spec=httpx.Request)
    # raise_for_status: raise for 4xx/5xx when called.
    if status_code >= 400:
        resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                f"status {status_code}", request=resp.request, response=resp
            )
        )
    else:
        resp.raise_for_status = MagicMock()
    return resp


def _fast_bucket() -> TokenBucket:
    """A rate limiter that never blocks — keeps tests deterministic."""
    return TokenBucket(rate_per_sec=10_000, capacity=100)


def _make_client(
    http: AsyncMock,
    cache: MagicMock,
    *,
    backoff_base: float = 0.0,
) -> S2Client:
    return S2Client(
        http_client=http,
        cache=cache,
        rate_limiter=_fast_bucket(),
        _backoff_base=backoff_base,
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_paper_search_hits_network_when_cache_miss(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    monkeypatch.delenv("S2_DISABLED", raising=False)

    cache = MagicMock()
    cache.get.return_value = None

    http = AsyncMock()
    http.get.return_value = _make_response(200, {"data": [{"paperId": "abc"}]})

    client = _make_client(http, cache)
    result = await client.paper_search("sleep")

    assert result == {"data": [{"paperId": "abc"}]}
    http.get.assert_called_once()
    # URL + params sanity-check.
    call = http.get.call_args
    assert call.args[0] == "https://api.semanticscholar.org/graph/v1/paper/search"
    assert call.kwargs["params"]["query"] == "sleep"
    assert call.kwargs["params"]["limit"] == 20
    cache.set.assert_called_once()


async def test_paper_search_returns_cached(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    monkeypatch.delenv("S2_DISABLED", raising=False)

    cache = MagicMock()
    cache.get.return_value = {"data": [{"paperId": "cached"}]}
    http = AsyncMock()

    client = _make_client(http, cache)
    result = await client.paper_search("sleep")

    assert result == {"data": [{"paperId": "cached"}]}
    http.get.assert_not_called()
    cache.set.assert_not_called()


async def test_paper_passes_fields_param(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    monkeypatch.delenv("S2_DISABLED", raising=False)

    cache = MagicMock()
    cache.get.return_value = None
    http = AsyncMock()
    http.get.return_value = _make_response(200, {"paperId": "xyz", "title": "t"})

    client = _make_client(http, cache)
    result = await client.paper("xyz", fields="title,year")

    assert result["paperId"] == "xyz"
    call = http.get.call_args
    assert call.args[0] == "https://api.semanticscholar.org/graph/v1/paper/xyz"
    assert call.kwargs["params"] == {"fields": "title,year"}
    # 7-day TTL for paper metadata.
    assert cache.set.call_args.kwargs["ttl_override"] == 604800


async def test_references_endpoint(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    cache = MagicMock()
    cache.get.return_value = None
    http = AsyncMock()
    http.get.return_value = _make_response(200, {"data": []})

    client = _make_client(http, cache)
    await client.references("xyz", limit=25)

    call = http.get.call_args
    assert call.args[0] == "https://api.semanticscholar.org/graph/v1/paper/xyz/references"
    assert call.kwargs["params"]["limit"] == 25


async def test_citations_endpoint(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    cache = MagicMock()
    cache.get.return_value = None
    http = AsyncMock()
    http.get.return_value = _make_response(200, {"data": []})

    client = _make_client(http, cache)
    await client.citations("xyz", limit=30)

    call = http.get.call_args
    assert call.args[0] == "https://api.semanticscholar.org/graph/v1/paper/xyz/citations"
    assert call.kwargs["params"]["limit"] == 30


async def test_embedding_endpoint_long_ttl(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    monkeypatch.delenv("S2_DISABLED", raising=False)

    cache = MagicMock()
    cache.get.return_value = None
    http = AsyncMock()
    http.get.return_value = _make_response(
        200,
        {
            "paperId": "xyz",
            "embedding": {"model": "specter_v2", "vector": [0.1, 0.2, 0.3]},
        },
    )

    client = _make_client(http, cache)
    result = await client.embedding("xyz")

    assert result["paperId"] == "xyz"
    assert result["embedding"]["model"] == "specter_v2"
    call = http.get.call_args
    assert (
        call.args[0]
        == "https://api.semanticscholar.org/graph/v1/paper/xyz/embedding/specter_v2"
    )
    # 7-day TTL for embeddings (stable data).
    assert cache.set.call_args.kwargs["ttl_override"] == 604800


async def test_recommendations_uses_different_base_url(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    cache = MagicMock()
    cache.get.return_value = None
    http = AsyncMock()
    http.get.return_value = _make_response(200, {"recommendedPapers": []})

    client = _make_client(http, cache)
    await client.recommendations("xyz", limit=5)

    call = http.get.call_args
    assert (
        call.args[0]
        == "https://api.semanticscholar.org/recommendations/v1/papers/forpaper/xyz"
    )
    # Must NOT have /graph/v1 baked in.
    assert "/graph/v1" not in call.args[0]


# ---------------------------------------------------------------------------
# Retry / backoff
# ---------------------------------------------------------------------------


async def test_retries_on_429_then_succeeds(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    cache = MagicMock()
    cache.get.return_value = None

    http = AsyncMock()
    http.get.side_effect = [
        _make_response(429),
        _make_response(429),
        _make_response(200, {"data": [{"paperId": "ok"}]}),
    ]

    client = _make_client(http, cache, backoff_base=0.0)
    result = await client.paper_search("sleep")
    assert result["data"][0]["paperId"] == "ok"
    assert http.get.call_count == 3
    cache.set.assert_called_once()


async def test_retries_on_500_then_succeeds(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    cache = MagicMock()
    cache.get.return_value = None

    http = AsyncMock()
    http.get.side_effect = [
        _make_response(503),
        _make_response(200, {"data": [{"paperId": "ok-500"}]}),
    ]

    client = _make_client(http, cache, backoff_base=0.0)
    result = await client.paper_search("sleep")
    assert result["data"][0]["paperId"] == "ok-500"
    assert http.get.call_count == 2


async def test_max_retries_exhausted_raises(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    cache = MagicMock()
    cache.get.return_value = None

    http = AsyncMock()
    http.get.return_value = _make_response(429)

    client = _make_client(http, cache, backoff_base=0.0)
    with pytest.raises(httpx.HTTPStatusError):
        await client.paper_search("sleep")
    # initial attempt + 4 retries = 5 total.
    assert http.get.call_count == 5
    cache.set.assert_not_called()


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------


async def test_s2_disabled_returns_empty_dict(monkeypatch):
    monkeypatch.setenv("S2_DISABLED", "true")
    cache = MagicMock()
    http = AsyncMock()

    client = _make_client(http, cache)
    result = await client.paper_search("sleep")

    assert result == {}
    http.get.assert_not_called()
    cache.get.assert_not_called()
    cache.set.assert_not_called()


async def test_s2_disabled_case_insensitive(monkeypatch):
    monkeypatch.setenv("S2_DISABLED", "TRUE")
    cache = MagicMock()
    http = AsyncMock()
    client = _make_client(http, cache)
    assert await client.paper("xyz") == {}


# ---------------------------------------------------------------------------
# API key
# ---------------------------------------------------------------------------


async def test_s2_api_key_sets_header(monkeypatch):
    monkeypatch.setenv("S2_API_KEY", "abc123")
    monkeypatch.delenv("S2_DISABLED", raising=False)

    cache = MagicMock()
    http = AsyncMock()
    client = S2Client(
        http_client=http,
        cache=cache,
        rate_limiter=_fast_bucket(),
    )
    assert client.headers == {"x-api-key": "abc123"}


async def test_no_api_key_no_header(monkeypatch):
    monkeypatch.delenv("S2_API_KEY", raising=False)
    monkeypatch.delenv("S2_DISABLED", raising=False)
    cache = MagicMock()
    http = AsyncMock()
    client = S2Client(
        http_client=http,
        cache=cache,
        rate_limiter=_fast_bucket(),
    )
    assert client.headers == {}


async def test_s2_api_key_bumps_rate(monkeypatch):
    """Default rate is 10/s with a key, 1/s without. Verified by inspecting
    the rate limiter's configured rate/capacity."""
    monkeypatch.delenv("S2_DISABLED", raising=False)

    monkeypatch.setenv("S2_API_KEY", "abc123")
    client_with_key = S2Client(http_client=AsyncMock(), cache=MagicMock())
    assert client_with_key.rate.rate == 10
    assert client_with_key.rate.capacity == 10

    monkeypatch.delenv("S2_API_KEY", raising=False)
    client_no_key = S2Client(http_client=AsyncMock(), cache=MagicMock())
    assert client_no_key.rate.rate == 1
    assert client_no_key.rate.capacity == 1


async def test_injected_rate_limiter_wins(monkeypatch):
    """Explicit ``rate_limiter=`` argument overrides env-based default."""
    monkeypatch.setenv("S2_API_KEY", "abc123")
    custom = TokenBucket(rate_per_sec=3, capacity=3)
    client = S2Client(
        http_client=AsyncMock(),
        cache=MagicMock(),
        rate_limiter=custom,
    )
    assert client.rate is custom

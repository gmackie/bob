"""Tests for ``research_backend.openalex.works_since``.

Outbound HTTP is mocked with ``unittest.mock.AsyncMock``. A non-blocking
:class:`TokenBucket` keeps wall time sub-second. The async style matches
:mod:`tests.test_s2_client`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from research_backend.openalex import works_since
from research_backend.s2.rate_limit import TokenBucket

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fast_bucket() -> TokenBucket:
    """A rate limiter that never blocks — keeps tests deterministic."""
    return TokenBucket(rate_per_sec=10_000, capacity=100)


def _make_response(status_code: int, json_body: dict | None = None) -> MagicMock:
    """Build a mock response shaped like ``httpx.Response``."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body or {}
    resp.request = MagicMock(spec=httpx.Request)
    if status_code >= 400:
        resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                f"status {status_code}", request=resp.request, response=resp
            )
        )
    else:
        resp.raise_for_status = MagicMock()
    return resp


def _page(results: list[dict], next_cursor: str | None) -> dict:
    return {
        "results": results,
        "meta": {"next_cursor": next_cursor},
    }


def _work(wid: str, pub_date: str, title: str = "t") -> dict:
    return {"id": wid, "publication_date": pub_date, "title": title}


def _last_call_params(http: AsyncMock) -> dict[str, list[str]]:
    """Return the outgoing query params of the most recent ``http.get`` call."""
    call = http.get.call_args
    return call.kwargs["params"]


def _last_call_headers(http: AsyncMock) -> dict[str, str] | None:
    """Return the headers (if any) passed on the most recent ``http.get`` call."""
    call = http.get.call_args
    return call.kwargs.get("headers")


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for env in ("OPENALEX_MAILTO", "UNPAYWALL_EMAIL", "OPENALEX_API_KEY"):
        monkeypatch.delenv(env, raising=False)


# ---------------------------------------------------------------------------
# Param construction
# ---------------------------------------------------------------------------


async def test_works_since_builds_correct_filter_and_search_params(monkeypatch):
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.return_value = _make_response(200, _page([], None))

    cursor = datetime(2025, 1, 15, tzinfo=timezone.utc)
    await works_since(
        cursor=cursor,
        query_terms=["sleep", "glp1"],
        session=http,
        rate_limiter=_fast_bucket(),
    )

    params = _last_call_params(http)
    assert params["filter"] == "from_publication_date:2025-01-15"
    # Space-joined search terms; httpx URL-encodes the space but the param
    # value we send in is literal.
    assert params["search"] == "sleep glp1"
    assert params["cursor"] == "*"
    assert params["per-page"] == 25


async def test_works_since_with_none_cursor_omits_filter(monkeypatch):
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.return_value = _make_response(200, _page([], None))

    await works_since(
        cursor=None,
        query_terms=["foo"],
        session=http,
        rate_limiter=_fast_bucket(),
    )

    params = _last_call_params(http)
    assert "filter" not in params
    assert params["search"] == "foo"


async def test_works_since_mailto_and_api_key_from_env(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("OPENALEX_MAILTO", "me@example.com")
    monkeypatch.setenv("OPENALEX_API_KEY", "k123")
    http = AsyncMock()
    http.get.return_value = _make_response(200, _page([], None))

    await works_since(cursor=None, session=http, rate_limiter=_fast_bucket())

    # mailto still rides on the query string (no secret there, just an
    # identity for OpenAlex's polite pool). api_key now rides on the
    # Authorization header so a 4xx/5xx HTTPStatusError can't leak it
    # into last_error or logs.
    params = _last_call_params(http)
    assert params["mailto"] == "me@example.com"
    assert "api_key" not in params

    headers = _last_call_headers(http)
    assert headers == {"Authorization": "k123"}


async def test_works_since_omits_headers_when_no_api_key(monkeypatch):
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.return_value = _make_response(200, _page([], None))

    await works_since(cursor=None, session=http, rate_limiter=_fast_bucket())

    # No api_key set → no Authorization header; kwargs should pass None.
    assert _last_call_headers(http) is None


def test_redact_secrets_strips_api_key_and_mailto():
    # Representative of what httpx.HTTPStatusError.__str__ would contain
    # if we'd kept api_key as a query param. After moving api_key to the
    # Authorization header the function still matters for defense-in-depth.
    from research_backend.openalex import redact_secrets

    msg = (
        "Client error '403 Forbidden' for url "
        "'https://api.openalex.org/works?cursor=*&mailto=me@example.com"
        "&api_key=super-secret-123&per-page=25'"
    )
    out = redact_secrets(msg)
    assert "super-secret-123" not in out
    assert "me@example.com" not in out
    assert "api_key=[redacted]" in out
    assert "mailto=[redacted]" in out


def test_redact_secrets_returns_input_when_no_match():
    from research_backend.openalex import redact_secrets

    assert redact_secrets("plain error, no URL") == "plain error, no URL"
    assert redact_secrets("") == ""


async def test_works_since_mailto_falls_back_to_unpaywall_email(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("UNPAYWALL_EMAIL", "fallback@example.com")
    http = AsyncMock()
    http.get.return_value = _make_response(200, _page([], None))

    await works_since(cursor=None, session=http, rate_limiter=_fast_bucket())

    params = _last_call_params(http)
    assert params["mailto"] == "fallback@example.com"


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


async def test_works_since_follows_cursor_pagination(monkeypatch):
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.side_effect = [
        _make_response(
            200,
            _page(
                [_work("W1", "2025-03-01"), _work("W2", "2025-02-28")],
                next_cursor="abc",
            ),
        ),
        _make_response(
            200,
            _page([_work("W3", "2025-02-27")], next_cursor=None),
        ),
    ]

    out = await works_since(
        cursor=datetime(2025, 1, 1, tzinfo=timezone.utc),
        session=http,
        rate_limiter=_fast_bucket(),
    )

    assert [w["id"] for w in out] == ["W1", "W2", "W3"]
    assert http.get.call_count == 2
    # Page 2 should reuse the next_cursor from page 1.
    second_call_params = http.get.call_args_list[1].kwargs["params"]
    assert second_call_params["cursor"] == "abc"


async def test_works_since_respects_max_results(monkeypatch):
    _clear_env(monkeypatch)
    # 25 works per page. max_results=30 means we need 2 pages, 5 from page 2.
    page1 = [_work(f"W{i}", "2025-03-01") for i in range(25)]
    page2 = [_work(f"W{i}", "2025-02-28") for i in range(25, 50)]
    http = AsyncMock()
    http.get.side_effect = [
        _make_response(200, _page(page1, next_cursor="abc")),
        _make_response(200, _page(page2, next_cursor="def")),
    ]

    out = await works_since(
        cursor=datetime(2025, 1, 1, tzinfo=timezone.utc),
        limit_per_page=25,
        max_results=30,
        session=http,
        rate_limiter=_fast_bucket(),
    )

    assert len(out) == 30
    assert http.get.call_count == 2
    assert out[-1]["id"] == "W29"


async def test_works_since_stops_on_no_next_cursor(monkeypatch):
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.return_value = _make_response(
        200,
        _page([_work("W1", "2025-03-01")], next_cursor=None),
    )

    out = await works_since(
        cursor=datetime(2025, 1, 1, tzinfo=timezone.utc),
        session=http,
        rate_limiter=_fast_bucket(),
    )

    assert [w["id"] for w in out] == ["W1"]
    assert http.get.call_count == 1


# ---------------------------------------------------------------------------
# Safety nets
# ---------------------------------------------------------------------------


async def test_works_since_drops_works_older_than_cursor(monkeypatch):
    _clear_env(monkeypatch)
    # OpenAlex misbehaves and returns a mix including pre-cursor dates.
    http = AsyncMock()
    http.get.return_value = _make_response(
        200,
        _page(
            [
                _work("W1", "2025-03-01"),  # fresh
                _work("W2", "2024-12-15"),  # stale — must be dropped
                _work("W3", "2025-02-28"),  # fresh
            ],
            next_cursor=None,
        ),
    )

    out = await works_since(
        cursor=datetime(2025, 1, 15, tzinfo=timezone.utc),
        session=http,
        rate_limiter=_fast_bucket(),
    )

    assert [w["id"] for w in out] == ["W1", "W3"]


async def test_works_since_dedups_by_id(monkeypatch):
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.side_effect = [
        _make_response(
            200,
            _page(
                [_work("W1", "2025-03-01"), _work("W2", "2025-02-28")],
                next_cursor="abc",
            ),
        ),
        _make_response(
            200,
            # W2 appears again on page 2 — should be filtered out.
            _page(
                [_work("W2", "2025-02-28"), _work("W3", "2025-02-20")],
                next_cursor=None,
            ),
        ),
    ]

    out = await works_since(
        cursor=datetime(2025, 1, 1, tzinfo=timezone.utc),
        session=http,
        rate_limiter=_fast_bucket(),
    )

    ids = [w["id"] for w in out]
    assert ids == ["W1", "W2", "W3"]
    assert len(ids) == len(set(ids))


async def test_works_since_stops_when_all_page_results_stale(monkeypatch):
    """If every work on a page predates the cursor, stop fetching — OpenAlex
    is returning data outside our filter and pagination will just burn calls."""
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.return_value = _make_response(
        200,
        _page(
            [_work("W1", "2024-06-01"), _work("W2", "2024-05-15")],
            next_cursor="abc",  # would paginate further, but we abort
        ),
    )

    out = await works_since(
        cursor=datetime(2025, 1, 15, tzinfo=timezone.utc),
        session=http,
        rate_limiter=_fast_bucket(),
    )

    assert out == []
    assert http.get.call_count == 1


async def test_works_since_hits_correct_url(monkeypatch):
    _clear_env(monkeypatch)
    http = AsyncMock()
    http.get.return_value = _make_response(200, _page([], None))

    await works_since(cursor=None, session=http, rate_limiter=_fast_bucket())

    call = http.get.call_args
    assert call.args[0] == "https://api.openalex.org/works"

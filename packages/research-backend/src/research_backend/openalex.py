"""OpenAlex Works API client.

Thin async wrapper around OpenAlex's ``/works`` endpoint, scoped to the one
use case Phase 2 needs today: fetching works published on/after a datetime
watermark, optionally filtered by full-text search, with cursor pagination.

Conventions
-----------
* **Async**: matches :mod:`research_backend.s2.client`. The standing-interests
  scheduler (Task 6.1) is async, so making callers ``await`` is cheaper than
  bolting a sync client onto an async worker.
* **Mailto / polite pool**: OpenAlex's free tier grants 10 req/s and better
  queue placement for requests that include a ``mailto=`` query param. We pull
  this from ``OPENALEX_MAILTO``; if that's unset we fall back to
  ``UNPAYWALL_EMAIL`` (same identity, already configured in this repo).
* **API key**: ``OPENALEX_API_KEY`` — OpenAlex doesn't require one today but
  the env var exists in settings. If present it's sent as ``api_key=``.
* **Rate limit**: reuses :class:`research_backend.s2.rate_limit.TokenBucket`.
  Default 10 req/s since the polite pool allows that; callers can inject a
  slower bucket if they're running many workers.

The module-level :func:`works_since` is the only public entry point today. If
this surface grows (e.g. fetch a single work by ID for source_upsert), promote
to a class mirroring ``S2Client``.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any

import httpx

from research_backend.s2.rate_limit import TokenBucket

__all__ = ["redact_secrets", "works_since"]


# Redaction: OpenAlex api_key (now sent as header, not query param) and the
# mailto identity can both end up in logs / last_error strings via
# httpx.HTTPStatusError, which renders the full request URL. We strip them
# anywhere a user-facing string might be written to persistent storage.
#
# Matches `api_key=...` and `mailto=...` up to the next `&` or end-of-string.
_SECRET_QUERY_PATTERN = re.compile(
    r"(?i)([?&])(api_key|mailto)=[^&\s]*"
)


def redact_secrets(msg: str) -> str:
    """Strip OpenAlex secrets from any URL-shaped substring.

    Safe to call on arbitrary strings (returns input unchanged when the
    patterns aren't present). Replaces the value with ``[redacted]`` and
    preserves the surrounding query-string structure so the remaining URL
    is still useful for debugging.
    """
    if not msg:
        return msg
    return _SECRET_QUERY_PATTERN.sub(r"\1\2=[redacted]", msg)


OPENALEX_BASE = "https://api.openalex.org"
_WORKS_ENDPOINT = "/works"
_MAX_PER_PAGE = 200  # OpenAlex per-page cap.


def _resolve_mailto() -> str | None:
    """Return the mailto identity for the polite pool, or ``None``.

    Prefers ``OPENALEX_MAILTO``; falls back to ``UNPAYWALL_EMAIL`` since that's
    already the user's research contact address in settings.
    """
    return os.getenv("OPENALEX_MAILTO") or os.getenv("UNPAYWALL_EMAIL") or None


def _resolve_api_key() -> str | None:
    key = os.getenv("OPENALEX_API_KEY")
    return key or None


def _build_params(
    cursor_date: str | None,
    query_terms: list[str] | None,
    per_page: int,
    cursor_token: str,
) -> dict[str, Any]:
    """Construct OpenAlex query params.

    ``cursor_date`` is the ``YYYY-MM-DD`` string (or ``None`` for no filter).
    ``cursor_token`` is ``"*"`` on the first page, otherwise the value echoed
    back in ``meta.next_cursor``.

    ``api_key`` is NOT placed in the query params — it's sent via the
    ``Authorization`` header by :func:`_build_headers` so it can't leak into
    ``httpx.HTTPStatusError`` messages, access logs, or ``last_error``.
    """
    params: dict[str, Any] = {
        "per-page": per_page,
        "cursor": cursor_token,
    }
    if cursor_date is not None:
        params["filter"] = f"from_publication_date:{cursor_date}"
    if query_terms:
        # OpenAlex's ``search`` param is full-text ANDed across terms; space
        # separation is equivalent to AND for their ranker.
        params["search"] = " ".join(t for t in query_terms if t)
    mailto = _resolve_mailto()
    if mailto:
        params["mailto"] = mailto
    return params


def _build_headers() -> dict[str, str]:
    """Return headers for an OpenAlex request.

    OpenAlex accepts the API key via the ``Authorization`` header per their
    docs (https://docs.openalex.org/how-to-use-the-api/api-overview). Sending
    it as a header rather than a query parameter prevents the key from
    landing in ``httpx.HTTPStatusError.__str__`` (which renders the full
    request URL) when a 4xx/5xx lands and the error text gets persisted to
    ``standing_interest.last_error`` or stderr via ``logger.exception``.
    """
    headers: dict[str, str] = {}
    api_key = _resolve_api_key()
    if api_key:
        headers["Authorization"] = api_key
    return headers


def _work_is_older_than_cursor(work: dict, cursor_date: str | None) -> bool:
    """True if ``work.publication_date`` predates the watermark.

    Safety net for the case where OpenAlex returns a work outside our filter
    (rare, but defensive). Works without a ``publication_date`` field are
    treated as fresh so we don't silently drop them.
    """
    if cursor_date is None:
        return False
    pub_date = work.get("publication_date")
    if not pub_date:
        return False
    return pub_date < cursor_date


async def works_since(
    cursor: datetime | None,
    query_terms: list[str] | None = None,
    limit_per_page: int = 25,
    max_results: int = 100,
    session: httpx.AsyncClient | None = None,
    rate_limiter: TokenBucket | None = None,
) -> list[dict]:
    """Fetch OpenAlex Works published on/after ``cursor``.

    Parameters
    ----------
    cursor:
        UTC datetime watermark; works with ``publication_date`` older than
        ``cursor.date()`` are filtered out in memory. Pass ``None`` to fetch
        all recent works (no ``from_publication_date`` filter).
    query_terms:
        Optional list of full-text search terms, space-joined into OpenAlex's
        ``search=`` param.
    limit_per_page:
        OpenAlex per-page size (clamped to 1..200). Default 25 keeps payloads
        small for standing-interest polls.
    max_results:
        Hard upper bound on returned works. Default 100.
    session:
        Optional :class:`httpx.AsyncClient` to reuse connections. If omitted,
        a client is created per call.
    rate_limiter:
        Optional :class:`TokenBucket`. Defaults to 10 req/s / burst 10, which
        matches OpenAlex's polite pool.

    Returns
    -------
    list[dict]
        Work dicts as returned by OpenAlex (``id``, ``title``, ``doi``,
        ``publication_date``, ``authorships``, …). Deduplicated by ``id``
        across pages; emitted in the order OpenAlex returns them (descending
        ``publication_date`` when the filter is active).

    Pagination stops when any of:
      * ``max_results`` is reached,
      * OpenAlex returns no ``meta.next_cursor``,
      * every work on a page is older than ``cursor`` (belt-and-suspenders
        stop condition in case the filter is ignored).
    """
    per_page = max(1, min(limit_per_page, _MAX_PER_PAGE))
    cursor_date: str | None = None
    if cursor is not None:
        cursor_date = cursor.date().isoformat()

    if rate_limiter is None:
        rate_limiter = TokenBucket(rate_per_sec=10, capacity=10)

    owns_session = session is None
    client = session if session is not None else httpx.AsyncClient(timeout=30.0)

    results: list[dict] = []
    seen_ids: set[str] = set()
    cursor_token = "*"

    try:
        while len(results) < max_results:
            params = _build_params(cursor_date, query_terms, per_page, cursor_token)
            headers = _build_headers()
            await rate_limiter.acquire()
            response = await client.get(
                OPENALEX_BASE + _WORKS_ENDPOINT,
                params=params,
                headers=headers if headers else None,
            )
            response.raise_for_status()
            payload = response.json()

            page_results = payload.get("results", []) or []
            page_all_stale = bool(page_results)  # only meaningful if page non-empty

            for work in page_results:
                work_id = work.get("id")
                if work_id and work_id in seen_ids:
                    continue
                if _work_is_older_than_cursor(work, cursor_date):
                    continue
                page_all_stale = False
                if work_id:
                    seen_ids.add(work_id)
                results.append(work)
                if len(results) >= max_results:
                    break

            if len(results) >= max_results:
                break

            # Stop if OpenAlex returned stale-only pages (filter bypass) or
            # there's no next cursor to follow.
            if page_results and page_all_stale:
                break

            next_cursor = (payload.get("meta") or {}).get("next_cursor")
            if not next_cursor:
                break
            cursor_token = next_cursor
    finally:
        if owns_session:
            await client.aclose()

    return results

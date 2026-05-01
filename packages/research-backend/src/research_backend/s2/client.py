"""Async client for the Semantic Scholar Graph & Recommendations APIs.

Wraps an injected :class:`httpx.AsyncClient`, an :class:`S2Cache` for
response caching, and a :class:`TokenBucket` for per-process rate limiting.

Key behaviors
-------------
* **Cache-first**: every request consults ``S2Cache.get`` before hitting the
  network; hits short-circuit the HTTP call entirely.
* **Rate limiting**: the configured :class:`TokenBucket` is acquired before
  each outbound HTTP attempt (not before cache reads). Default is 1 req/s
  without an API key and 10 req/s with one.
* **Retry on 429/5xx**: up to 4 retries with exponential backoff
  ``min(cap, base * 2**attempt)`` seconds plus ±20% jitter. The final failure
  re-raises ``httpx.HTTPStatusError``.
* **Kill switch**: ``S2_DISABLED=true`` in the environment short-circuits
  every endpoint to ``{}`` — useful for staging environments with no key.
* **API key**: ``S2_API_KEY`` is read once at construction and sent as the
  ``x-api-key`` header; it also bumps the default rate limit.

Endpoints covered
-----------------
* ``paper_search(query, limit, **kwargs)`` -> ``/paper/search``
* ``paper(paper_id, fields)`` -> ``/paper/{id}`` (7-day TTL — metadata is stable)
* ``references(paper_id, limit)`` -> ``/paper/{id}/references``
* ``citations(paper_id, limit)`` -> ``/paper/{id}/citations``
* ``recommendations(paper_id, limit)`` -> ``/recommendations/v1/papers/forpaper/{id}``
  (note: different base URL; handled via ``_request(..., base_override=...)``)
* ``embedding(paper_id)`` -> ``/paper/{id}/embedding/specter_v2``
  (7-day TTL — embeddings are stable per paper)
"""

from __future__ import annotations

import asyncio
import os
import random
from typing import Any

import httpx

from .cache import S2Cache, cache_key
from .rate_limit import TokenBucket

__all__ = ["S2Client", "get_shared_rate_limiter"]


# Process-wide TokenBucket shared across all S2Client instances.
#
# Each dive previously constructed its own S2Client via _build_default_s2
# (dive/worker.py), and each S2Client allocated its own TokenBucket. N
# concurrent dives = N x the S2 rate limit globally — guaranteed 429s and
# a path to an IP ban once the vault grows past a handful of active dives.
#
# Rate at bucket construction time is fixed by S2_API_KEY presence, same
# as the per-instance default: 10 r/s with a key, 1 r/s without.
_SHARED_RATE_LIMITER: TokenBucket | None = None


def get_shared_rate_limiter() -> TokenBucket:
    """Return the process-wide S2 TokenBucket, creating it on first call."""
    global _SHARED_RATE_LIMITER
    if _SHARED_RATE_LIMITER is None:
        default_rate = 10 if os.getenv("S2_API_KEY") else 1
        _SHARED_RATE_LIMITER = TokenBucket(default_rate, default_rate)
    return _SHARED_RATE_LIMITER


_DEFAULT_PAPER_FIELDS = (
    "title,abstract,tldr,citationCount,influentialCitationCount,year,venue,authors"
)
_DEFAULT_REF_FIELDS = "title,year,authors,citationCount"


class S2Client:
    """Semantic Scholar Graph + Recommendations client."""

    BASE = "https://api.semanticscholar.org/graph/v1"
    RECOMMENDATIONS_BASE = "https://api.semanticscholar.org"
    MAX_RETRIES = 4  # i.e. up to 5 total attempts (initial + 4 retries)
    BACKOFF_CAP = 60.0

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        cache: S2Cache,
        rate_limiter: TokenBucket | None = None,
        *,
        _backoff_base: float = 2.0,
    ) -> None:
        self.http = http_client
        self.cache = cache

        api_key = os.getenv("S2_API_KEY")
        self.headers: dict[str, str] = {"x-api-key": api_key} if api_key else {}

        if rate_limiter is not None:
            self.rate = rate_limiter
        else:
            default_rate = 10 if api_key else 1
            self.rate = TokenBucket(default_rate, default_rate)

        self.disabled = os.getenv("S2_DISABLED", "false").lower() == "true"
        # Exposed as a private kwarg so tests can shrink the backoff without
        # monkey-patching ``asyncio.sleep`` globally.
        self._backoff_base = _backoff_base

    async def _request(
        self,
        endpoint: str,
        params: dict[str, Any],
        ttl: int = 86400,
        *,
        base_override: str | None = None,
    ) -> dict:
        """Fetch ``endpoint`` with cache + rate-limit + retry.

        ``endpoint`` is cache-keyed verbatim (including leading slash) so two
        endpoints with overlapping params don't collide. ``base_override``
        lets callers target the recommendations host without polluting the
        cache key.
        """
        if self.disabled:
            return {}

        key = cache_key(endpoint, params)
        hit = self.cache.get(key)
        if hit is not None:
            return hit

        base = base_override or self.BASE
        url = base + endpoint

        last_exc: httpx.HTTPStatusError | None = None
        for attempt in range(self.MAX_RETRIES + 1):
            await self.rate.acquire()
            response = await self.http.get(url, params=params, headers=self.headers)
            if response.status_code == 429 or response.status_code >= 500:
                last_exc = httpx.HTTPStatusError(
                    f"retryable status {response.status_code}",
                    request=response.request,
                    response=response,
                )
                if attempt == self.MAX_RETRIES:
                    raise last_exc
                backoff = min(
                    self.BACKOFF_CAP,
                    self._backoff_base * (2**attempt),
                ) * (0.8 + random.random() * 0.4)
                await asyncio.sleep(backoff)
                continue
            response.raise_for_status()
            data = response.json()
            self.cache.set(key, data, ttl_override=ttl)
            return data

        # Unreachable — loop either returns or raises — but keep mypy happy.
        assert last_exc is not None
        raise last_exc

    # ------------------------------------------------------------------
    # Public endpoint wrappers
    # ------------------------------------------------------------------

    async def paper_search(self, query: str, limit: int = 20, **kwargs: Any) -> dict:
        """Search papers by free-text query (default ttl = 1 day)."""
        params: dict[str, Any] = {"query": query, "limit": limit, **kwargs}
        return await self._request("/paper/search", params)

    async def paper(
        self,
        paper_id: str,
        fields: str = _DEFAULT_PAPER_FIELDS,
    ) -> dict:
        """Fetch full metadata for one paper. Cached for 7 days (stable data)."""
        return await self._request(
            f"/paper/{paper_id}",
            {"fields": fields},
            ttl=604800,
        )

    async def references(self, paper_id: str, limit: int = 50) -> dict:
        """List references (outgoing citations) for a paper."""
        return await self._request(
            f"/paper/{paper_id}/references",
            {"limit": limit, "fields": _DEFAULT_REF_FIELDS},
        )

    async def citations(self, paper_id: str, limit: int = 50) -> dict:
        """List citations (incoming) for a paper."""
        return await self._request(
            f"/paper/{paper_id}/citations",
            {"limit": limit, "fields": _DEFAULT_REF_FIELDS},
        )

    async def recommendations(self, paper_id: str, limit: int = 20) -> dict:
        """Paper recommendations. Lives on a different base URL."""
        return await self._request(
            f"/recommendations/v1/papers/forpaper/{paper_id}",
            {"limit": limit},
            base_override=self.RECOMMENDATIONS_BASE,
        )

    async def embedding(self, paper_id: str) -> dict:
        """Fetch SPECTER v2 embedding for a paper.

        Response shape: ``{"paperId": "...", "embedding": {"model":
        "specter_v2", "vector": [float, ...]}}``. Embeddings are stable per
        paper so we cache for 7 days.
        """
        return await self._request(
            f"/paper/{paper_id}/embedding/specter_v2",
            {},
            ttl=604800,  # 7 days
        )

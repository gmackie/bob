"""Async token-bucket rate limiter for outbound HTTP calls.

Used by :class:`research_backend.s2.client.S2Client` to keep Semantic Scholar
requests within published limits (1 req/s unaccredited, ~10 req/s with an API
key). The bucket refills continuously at ``rate_per_sec`` tokens/second and
burst-tolerates up to ``capacity`` calls.

Design notes
------------
* ``acquire()`` is ``async`` and awaits ``asyncio.sleep`` while throttling, so
  event-loop starvation is avoided.
* An :class:`asyncio.Lock` serializes token accounting; concurrent tasks see a
  consistent ``_tokens`` value. The lock is released during the sleep so other
  tasks can still update/refill the bucket.
* After sleeping we reset ``_tokens`` to ``0.0`` (i.e. we consumed the single
  token we were waiting for) rather than re-running the full refill math —
  this avoids double-crediting tokens that accrued while we slept.
"""

from __future__ import annotations

import asyncio
import time

__all__ = ["TokenBucket"]


class TokenBucket:
    """Simple async token bucket.

    Parameters
    ----------
    rate_per_sec:
        Steady-state token replenishment rate. Must be > 0.
    capacity:
        Maximum number of tokens the bucket can hold (also the burst size).
        Must be >= 1.
    """

    def __init__(self, rate_per_sec: float, capacity: int) -> None:
        if rate_per_sec <= 0:
            raise ValueError("rate_per_sec must be positive")
        if capacity < 1:
            raise ValueError("capacity must be >= 1")
        self.rate = float(rate_per_sec)
        self.capacity = int(capacity)
        self._tokens = float(capacity)
        self._last = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        """Block until one token is available, then consume it."""
        async with self._lock:
            now = time.monotonic()
            self._tokens = min(
                float(self.capacity),
                self._tokens + (now - self._last) * self.rate,
            )
            self._last = now
            if self._tokens >= 1:
                self._tokens -= 1
                return
            wait = (1.0 - self._tokens) / self.rate
        await asyncio.sleep(wait)
        async with self._lock:
            # We slept exactly long enough to earn one token; consume it.
            self._tokens = 0.0
            self._last = time.monotonic()

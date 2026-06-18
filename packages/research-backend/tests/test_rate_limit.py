"""Tests for ``research_backend.s2.rate_limit.TokenBucket``.

Timing assertions use generous upper bounds to keep the suite robust on slow
CI hosts while still exercising the burst/throttle behavior. All tests are
``async`` and rely on ``asyncio_mode = "auto"`` (see pyproject.toml).
"""

from __future__ import annotations

import asyncio
import time

import pytest

from research_backend.s2.rate_limit import TokenBucket


async def test_bucket_allows_burst_up_to_capacity():
    """A full bucket should empty instantly up to its capacity."""
    bucket = TokenBucket(rate_per_sec=10, capacity=10)
    t0 = time.monotonic()
    for _ in range(10):
        await bucket.acquire()
    elapsed = time.monotonic() - t0
    # 10 tokens already in the bucket; no sleeping should be required.
    assert elapsed < 0.05, f"burst took {elapsed:.3f}s, expected <0.05s"


async def test_bucket_throttles_past_capacity():
    """Beyond the burst, throttling should take ~1/rate per extra token."""
    bucket = TokenBucket(rate_per_sec=20, capacity=2)
    t0 = time.monotonic()
    # 2 free (capacity), then 4 more at 20/s = 4 * 0.05s = 0.2s of sleeping.
    for _ in range(6):
        await bucket.acquire()
    elapsed = time.monotonic() - t0
    assert elapsed >= 0.15, f"throttled 6 calls in {elapsed:.3f}s, expected >=0.15s"


async def test_bucket_refills_over_time():
    """After draining the bucket, waiting long enough should restore tokens."""
    bucket = TokenBucket(rate_per_sec=10, capacity=3)
    for _ in range(3):
        await bucket.acquire()
    # Drain -> wait a half-second -> bucket should have ~5 tokens (capped at 3).
    await asyncio.sleep(0.5)
    t0 = time.monotonic()
    await bucket.acquire()
    elapsed = time.monotonic() - t0
    assert elapsed < 0.02, f"post-refill acquire took {elapsed:.3f}s, expected <0.02s"


async def test_bucket_is_task_safe():
    """Concurrent tasks should all complete without exception or deadlock."""
    bucket = TokenBucket(rate_per_sec=5, capacity=5)
    t0 = time.monotonic()
    await asyncio.gather(*(bucket.acquire() for _ in range(5)))
    elapsed = time.monotonic() - t0
    # All 5 fit in the initial capacity -> no throttling required.
    assert elapsed < 0.05, f"5 concurrent acquires took {elapsed:.3f}s, expected <0.05s"


async def test_bucket_rejects_bad_args():
    """Constructor guards against nonsense arguments."""
    with pytest.raises(ValueError):
        TokenBucket(rate_per_sec=0, capacity=1)
    with pytest.raises(ValueError):
        TokenBucket(rate_per_sec=-1, capacity=1)
    with pytest.raises(ValueError):
        TokenBucket(rate_per_sec=1, capacity=0)

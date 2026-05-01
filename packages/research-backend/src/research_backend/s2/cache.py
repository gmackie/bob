"""S2 API response cache backed by the per-vault ``s2_cache`` Postgres table.

The cache is keyed by a stable hash of ``(endpoint, params)`` so repeated calls
with the same logical request — even with differing Python dict ordering —
collapse to a single cache row. TTL-based expiry is enforced at read time.

Design notes
------------
* ``cache_key`` canonicalizes the params via ``json.dumps(sort_keys=True)`` so
  the hash is insensitive to Python dict iteration order (which varies across
  CPython versions / insertion order).
* ``default=str`` is passed to ``json.dumps`` so incidental non-JSON-native
  values like ``datetime`` objects hash to a stable string form instead of
  raising ``TypeError`` on the caller's behalf.
* ``S2Cache`` takes a **session factory** — a zero-arg callable returning a
  context-managed session — rather than a live session, so instances are safe
  to share across requests and threads. The factory is used with
  ``with self.Session() as s:``, matching the ``with Session(engine) as s``
  idiom used elsewhere in research-backend (see ``db.get_session``).
* Writes ``response_json`` via ``CAST(:v AS jsonb)`` to sidestep driver-level
  adapter differences between ``dict`` and JSONB across SQLAlchemy versions.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

__all__ = ["cache_key", "S2Cache"]


def cache_key(endpoint: str, params: dict[str, Any]) -> str:
    """Return a stable 40-char hex key for ``(endpoint, params)``.

    Order-independent over dict keys (top-level and nested). Non-JSON-native
    values (e.g. ``datetime``) are coerced via ``str()`` rather than raising.
    """
    canonical = json.dumps(
        {"e": endpoint, "p": params},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()[:40]


class S2Cache:
    """TTL'd JSONB cache over ``<schema>.s2_cache``."""

    _VALID_SCHEMAS = frozenset({"research_vault", "personal_vault"})

    def __init__(
        self,
        session_factory: Callable[[], Any],
        ttl_seconds: int = 86400,
        schema: str = "research_vault",
    ) -> None:
        if schema not in self._VALID_SCHEMAS:
            raise ValueError(f"invalid vault schema: {schema!r}")
        self.Session = session_factory
        self.ttl = ttl_seconds
        self.schema = schema

    def get(self, key: str) -> dict | None:
        """Return the cached response for ``key``, or ``None`` if miss/expired."""
        with self.Session() as s:
            row = s.execute(
                text(
                    f"SELECT response_json, expires_at "
                    f"FROM {self.schema}.s2_cache WHERE key = :k"
                ),
                {"k": key},
            ).first()
            if not row:
                return None
            expires_at = row.expires_at
            # Postgres returns timezone-aware datetimes, but coerce naive to UTC
            # defensively (some driver/SQLAlchemy combos strip tzinfo).
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < datetime.now(timezone.utc):
                return None
            return row.response_json

    def set(
        self,
        key: str,
        value: dict,
        ttl_override: int | None = None,
    ) -> None:
        """Upsert ``value`` under ``key``. Refreshes ``fetched_at`` and ``expires_at``."""
        ttl = ttl_override if ttl_override is not None else self.ttl
        expires = datetime.now(timezone.utc) + timedelta(seconds=ttl)
        with self.Session() as s:
            s.execute(
                text(
                    f"""
                    INSERT INTO {self.schema}.s2_cache
                        (key, response_json, fetched_at, expires_at)
                    VALUES (:k, CAST(:v AS jsonb), NOW(), :e)
                    ON CONFLICT (key) DO UPDATE
                      SET response_json = EXCLUDED.response_json,
                          fetched_at = EXCLUDED.fetched_at,
                          expires_at = EXCLUDED.expires_at
                    """
                ),
                {"k": key, "v": json.dumps(value), "e": expires},
            )
            s.commit()

    def invalidate(self, key: str) -> None:
        """Remove a cache entry. Useful for tests and manual purges."""
        with self.Session() as s:
            s.execute(
                text(f"DELETE FROM {self.schema}.s2_cache WHERE key = :k"),
                {"k": key},
            )
            s.commit()

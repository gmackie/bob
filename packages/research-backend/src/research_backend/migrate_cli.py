"""CLI entrypoint for backfilling research vault sources into Postgres.

Usage:
    uv run python -m research_backend.migrate_cli /path/to/vault

Or via environment variables:
    RESEARCH_VAULT_PATH=/path/to/vault DATABASE_URL=postgresql://... \
        uv run python -m research_backend.migrate_cli
"""

from __future__ import annotations

import os
import sys
import time
from collections import Counter
from pathlib import Path

from sqlmodel import Session, create_engine, text

from research_backend.migrate import SourceRecord, scan_all_sources

UPSERT_SQL = text("""
    INSERT INTO research_vault.sources
        (kind, external_id, title, body, content_hash, frontmatter, url, author, source_ts)
    VALUES
        (:kind, :external_id, :title, :body, :content_hash, :frontmatter, :url, :author,
         CAST(:source_ts AS timestamptz))
    ON CONFLICT (kind, external_id) DO UPDATE SET
        title        = EXCLUDED.title,
        body         = EXCLUDED.body,
        content_hash = EXCLUDED.content_hash,
        frontmatter  = EXCLUDED.frontmatter,
        url          = EXCLUDED.url,
        author       = EXCLUDED.author,
        source_ts    = EXCLUDED.source_ts
    WHERE research_vault.sources.content_hash != EXCLUDED.content_hash
""")


def resolve_vault_path() -> Path:
    """Resolve the research vault path from CLI arg or env var."""
    if len(sys.argv) > 1:
        vault = Path(sys.argv[1])
    else:
        env_val = os.environ.get("RESEARCH_VAULT_PATH", "")
        if not env_val:
            print(
                "ERROR: No vault path. Pass as argument or set RESEARCH_VAULT_PATH.",
                file=sys.stderr,
            )
            sys.exit(1)
        vault = Path(env_val)

    if not vault.is_dir():
        print(f"ERROR: {vault} is not a directory.", file=sys.stderr)
        sys.exit(1)
    return vault


def resolve_database_url() -> str:
    """Read DATABASE_URL from env."""
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("ERROR: DATABASE_URL not set.", file=sys.stderr)
        sys.exit(1)
    return url


def _strip_nul(s: str | None) -> str | None:
    """Remove NUL (0x00) bytes that Postgres text columns reject."""
    if s is None:
        return None
    return s.replace("\x00", "")


def record_to_params(rec: SourceRecord) -> dict:
    """Convert a SourceRecord to a dict suitable for the upsert SQL params."""
    return {
        "kind": rec.kind,
        "external_id": rec.external_id,
        "title": _strip_nul(rec.title),
        "body": _strip_nul(rec.body) or "",
        "content_hash": rec.content_hash,
        "frontmatter": _strip_nul(rec.frontmatter),
        "url": _strip_nul(rec.url),
        "author": _strip_nul(rec.author),
        "source_ts": rec.source_ts,
    }


def main() -> None:
    vault_path = resolve_vault_path()
    database_url = resolve_database_url()

    print(f"Scanning vault: {vault_path}")
    t0 = time.monotonic()
    records = scan_all_sources(vault_path)
    scan_elapsed = time.monotonic() - t0
    print(f"Scanned {len(records)} source records in {scan_elapsed:.1f}s")

    if not records:
        print("No records found. Nothing to migrate.")
        return

    engine = create_engine(database_url, echo=False)

    inserted = 0
    skipped = 0
    kind_counts: Counter[str] = Counter()

    t1 = time.monotonic()
    with Session(engine) as session:
        for i, rec in enumerate(records, 1):
            result = session.exec(UPSERT_SQL, params=record_to_params(rec))  # type: ignore[call-overload]
            rowcount = result.rowcount  # type: ignore[union-attr]
            kind_counts[rec.kind] += 1

            if rowcount == 1:
                # Could be insert or update; we count as upserted
                inserted += 1
            else:
                skipped += 1

            if i % 1000 == 0:
                session.commit()
                print(f"  ... processed {i}/{len(records)} records")

        session.commit()

    elapsed = time.monotonic() - t1
    print(f"\nMigration complete in {elapsed:.1f}s")
    print(f"  Upserted: {inserted}")
    print(f"  Skipped (content_hash match): {skipped}")
    print("\nRow counts by kind:")
    for kind, count in sorted(kind_counts.items()):
        print(f"  {kind}: {count}")


if __name__ == "__main__":
    main()

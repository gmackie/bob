"""Embedding pipeline: generate vector embeddings for vault sources via Ollama."""

from __future__ import annotations

import time
from typing import Callable

import httpx
import numpy as np
from sqlmodel import Session, text


def embed_sources(
    session: Session,
    *,
    schema: str = "research_vault",
    ollama_base_url: str = "http://localhost:11434",
    model: str = "nomic-embed-text",
    batch_size: int = 50,
    progress: Callable[[str], None] | None = None,
) -> int:
    """Embed all un-embedded sources in the given vault schema.

    Embeds one source at a time to handle intermittent Ollama failures
    gracefully. Sources that fail after retries are skipped.

    Returns the number of newly embedded sources.
    """
    log = progress or (lambda msg: print(msg, flush=True))

    unembedded = session.exec(
        text(f"""
            SELECT s.id, s.title, s.body
            FROM {schema}.sources s
            LEFT JOIN {schema}.embeddings e
                ON e.source_id = s.id AND e.model = :model
            WHERE e.source_id IS NULL
            ORDER BY s.id
        """),
        params={"model": model},
    ).all()

    total = len(unembedded)
    if total == 0:
        log("All sources already embedded.")
        return 0

    log(f"Embedding {total} sources with {model}...")
    dim = None
    count = 0
    skipped = 0

    for i, row in enumerate(unembedded):
        source_id = row[0]
        input_text = _source_text(row)

        vec = _ollama_embed_single(ollama_base_url, model, input_text)
        if vec is None:
            skipped += 1
            continue

        if dim is None:
            dim = len(vec)
        vec_bytes = vec.astype(np.float32).tobytes()

        session.exec(
            text(f"""
                INSERT INTO {schema}.embeddings (source_id, model, dim, vec)
                VALUES (:source_id, :model, :dim, :vec)
                ON CONFLICT (source_id, model) DO UPDATE
                    SET dim = :dim, vec = :vec, created_at = now()
            """),
            params={
                "source_id": source_id,
                "model": model,
                "dim": dim,
                "vec": vec_bytes,
            },
        )
        count += 1

        if count % batch_size == 0:
            session.commit()
            log(f"  Embedded {count}/{total} (skipped {skipped})")

    session.commit()
    log(f"Done. Embedded {count} sources, skipped {skipped} (dim={dim}).")
    return count


def _source_text(row: tuple) -> str:
    """Build embedding input from source title + body, truncated to ~1000 chars."""
    source_id, title, body = row
    parts = []
    if title:
        parts.append(title)
    if body:
        parts.append(body[:1000])
    return " ".join(parts) or f"source-{source_id}"


def _ollama_embed_single(
    base_url: str, model: str, text: str, max_retries: int = 3
) -> np.ndarray | None:
    """Embed a single text via Ollama. Returns None on persistent failure."""
    for attempt in range(max_retries):
        try:
            resp = httpx.post(
                f"{base_url}/api/embed",
                json={"model": model, "input": [text]},
                timeout=30.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                return np.array(data["embeddings"][0], dtype=np.float32)
            time.sleep(1 + attempt)
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout):
            time.sleep(1 + attempt)

    return None


def bytea_to_vec(data: bytes) -> np.ndarray:
    """Unpack Postgres bytea back into a float32 numpy array."""
    return np.frombuffer(data, dtype=np.float32)

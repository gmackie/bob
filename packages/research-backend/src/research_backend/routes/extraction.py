"""Note entity extraction + embedding endpoint.

POST /api/extraction/note -- receives a promoted note, extracts entities via
LLM, embeds via Ollama, and stores both in Postgres.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlmodel import Session, text

from research_backend.db import get_session
from research_backend.embeddings import _ollama_embed_single
from research_backend.llm import get_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/extraction", tags=["extraction"])

ENTITY_TYPES = frozenset({
    "person", "organization", "method", "dataset", "tool", "concept", "claim",
})

EXTRACTION_SYSTEM_PROMPT = (
    "You extract structured entities from research notes. "
    "Return ONLY a JSON array (no markdown fencing, no explanation). "
    "Types: person, organization, method, dataset, tool, concept, claim. "
    'Each element: {"name": "canonical name", "type": "one of the types", "salience": 0.0-1.0}. '
    "Normalize names (e.g. CRISPR/Cas9 -> CRISPR-Cas9). Max 20 entities. "
    "If no entities found, return []."
)


class NoteExtractionRequest(BaseModel):
    thread_id: str
    note_id: str
    title: str
    content: str
    kind: str
    content_hash: str


def _parse_entities(raw: str) -> list[dict[str, Any]]:
    """Parse LLM output into validated entity dicts."""
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].startswith("```") else lines[1:])
    try:
        entities = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM entity output: %s", raw[:200])
        return []
    if not isinstance(entities, list):
        return []
    validated = []
    for e in entities[:20]:
        if not isinstance(e, dict):
            continue
        name = e.get("name")
        etype = e.get("type")
        salience = e.get("salience", 0.5)
        if not name or not etype:
            continue
        if etype not in ENTITY_TYPES:
            etype = "concept"
        if not isinstance(salience, (int, float)):
            salience = 0.5
        salience = max(0.0, min(1.0, float(salience)))
        validated.append({"name": str(name), "type": etype, "salience": salience})
    return validated


@router.post("/note")
def extract_note(
    body: NoteExtractionRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Extract entities and embed a promoted note."""
    settings = request.app.state.settings

    # 1. Upsert note_index row
    existing = session.exec(
        text(
            "SELECT id FROM note_index WHERE thread_id = :tid AND note_id = :nid"
        ),
        params={"tid": body.thread_id, "nid": body.note_id},
    ).first()

    if existing:
        note_index_id = str(existing[0])
        session.execute(
            text(
                "UPDATE note_index SET title = :title, kind = :kind, "
                "content_hash = :hash, extracted_at = NULL "
                "WHERE id = :id"
            ),
            params={
                "title": body.title,
                "kind": body.kind,
                "hash": body.content_hash,
                "id": note_index_id,
            },
        )
        session.commit()
    else:
        session.execute(
            text(
                "INSERT INTO note_index (id, thread_id, note_id, title, kind, content_hash) "
                "VALUES (gen_random_uuid(), :tid, :nid, :title, :kind, :hash)"
            ),
            params={
                "tid": body.thread_id,
                "nid": body.note_id,
                "title": body.title,
                "kind": body.kind,
                "hash": body.content_hash,
            },
        )
        session.commit()
        row = session.exec(
            text("SELECT id FROM note_index WHERE thread_id = :tid AND note_id = :nid"),
            params={"tid": body.thread_id, "nid": body.note_id},
        ).first()
        note_index_id = str(row[0])

    # 2. LLM entity extraction
    entities_extracted = 0
    try:
        provider_type = os.environ.get("ANALYSIS_PROVIDER", "codex_app_server")
        provider = get_provider({"default": provider_type})
        prompt = f"Title: {body.title}\nKind: {body.kind}\n\n{body.content}"
        raw_output = provider.generate(prompt, system=EXTRACTION_SYSTEM_PROMPT)
        entities = _parse_entities(raw_output)

        # Delete old entities for this note, insert new ones
        session.execute(
            text("DELETE FROM note_entity WHERE note_index_id = :nid"),
            params={"nid": note_index_id},
        )
        for e in entities:
            session.execute(
                text(
                    "INSERT INTO note_entity "
                    "(id, note_index_id, thread_id, name, entity_type, salience) "
                    "VALUES (gen_random_uuid(), :nid, :tid, :name, :etype, :sal)"
                ),
                params={
                    "nid": note_index_id,
                    "tid": body.thread_id,
                    "name": e["name"],
                    "etype": e["type"],
                    "sal": e["salience"],
                },
            )
        session.commit()
        entities_extracted = len(entities)
    except Exception:
        logger.exception("Entity extraction failed for note %s", body.note_id)

    # 3. Embed note content via Ollama
    embedded = False
    try:
        vec = _ollama_embed_single(
            settings.ollama_base_url,
            settings.ollama_embedding_model,
            f"{body.title}\n\n{body.content}",
        )
        if vec is not None:
            encoded = np.asarray(vec, dtype=np.float32).tobytes()
            session.execute(
                text(
                    "UPDATE note_index SET embedding = :emb, embedding_model = :model "
                    "WHERE id = :id"
                ),
                params={
                    "emb": encoded,
                    "model": settings.ollama_embedding_model,
                    "id": note_index_id,
                },
            )
            session.commit()
            embedded = True
    except Exception:
        logger.exception("Embedding failed for note %s", body.note_id)

    # 4. Mark as extracted
    session.execute(
        text("UPDATE note_index SET extracted_at = now() WHERE id = :id"),
        params={"id": note_index_id},
    )
    session.commit()

    return {
        "note_index_id": note_index_id,
        "entities_extracted": entities_extracted,
        "embedded": embedded,
    }

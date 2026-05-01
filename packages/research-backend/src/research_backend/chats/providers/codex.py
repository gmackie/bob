"""Codex session rollout normalization.

Reads JSONL rollout files from ~/.codex/sessions/ and thread metadata
from ~/.codex/state_5.sqlite to produce normalized ChatConversation objects.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..models import ChatConversation, ChatMessage

DEFAULT_SESSIONS_DIR = Path.home() / ".codex" / "sessions"
DEFAULT_STATE_DB = Path.home() / ".codex" / "state_5.sqlite"


def parse_codex_sessions(
    sessions_dir: Path = DEFAULT_SESSIONS_DIR,
    state_db: Path = DEFAULT_STATE_DB,
    *,
    since: datetime | None = None,
) -> list[ChatConversation]:
    """Parse all Codex session rollouts into normalized conversations.

    Args:
        sessions_dir: Path to ~/.codex/sessions/
        state_db: Path to ~/.codex/state_5.sqlite (for thread metadata)
        since: Only include threads updated after this time (UTC)
    """
    thread_meta = _load_thread_metadata(state_db) if state_db.exists() else {}
    rollout_files = sorted(sessions_dir.rglob("rollout-*.jsonl"))

    conversations: list[ChatConversation] = []
    for rollout_path in rollout_files:
        thread_id = _extract_thread_id(rollout_path)
        if not thread_id:
            continue

        meta = thread_meta.get(thread_id, {})
        if since and meta.get("updated_at", 0) < since.timestamp():
            continue

        try:
            conversation = _parse_rollout(rollout_path, thread_id, meta)
            if conversation and conversation.messages:
                conversations.append(conversation)
        except Exception:
            continue

    return conversations


def _load_thread_metadata(state_db: Path) -> dict[str, dict[str, Any]]:
    """Load thread metadata from the Codex state SQLite DB."""
    threads: dict[str, dict[str, Any]] = {}
    try:
        conn = sqlite3.connect(f"file:{state_db}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(
            "SELECT id, title, model, cwd, created_at, updated_at, "
            "git_branch, git_origin_url, model_provider, source, "
            "first_user_message, cli_version "
            "FROM threads"
        )
        for row in cursor:
            threads[row["id"]] = dict(row)
        conn.close()
    except (sqlite3.Error, OSError):
        pass
    return threads


def _extract_thread_id(rollout_path: Path) -> str:
    """Extract the thread UUID from a rollout filename.

    Format: rollout-2026-04-03T17-44-08-019d55f2-7cf6-70d0-920f-b6264e63b492.jsonl
    The thread ID is everything after the datetime prefix.
    """
    stem = rollout_path.stem  # rollout-2026-04-03T17-44-08-019d55f2-...
    # Remove 'rollout-' prefix, then skip the datetime (YYYY-MM-DDTHH-MM-SS-)
    rest = stem.removeprefix("rollout-")
    # Datetime is 19 chars (2026-04-03T17-44-08), then a dash, then the UUID
    if len(rest) > 20 and rest[19] == "-":
        return rest[20:]
    return ""


def _parse_rollout(
    rollout_path: Path,
    thread_id: str,
    meta: dict[str, Any],
) -> ChatConversation | None:
    """Parse a single JSONL rollout file into a ChatConversation."""
    messages: list[ChatMessage] = []
    session_model = ""
    session_cwd = ""

    with open(rollout_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            event_type = event.get("type", "")
            payload = event.get("payload", {})
            timestamp = event.get("timestamp", "")

            if event_type == "session_meta":
                session_model = str(payload.get("model", ""))
                session_cwd = str(payload.get("cwd", ""))
                continue

            if event_type == "response_item":
                msg = _parse_response_item(payload, timestamp, session_model)
                if msg:
                    messages.append(msg)
                continue

            if event_type == "event_msg":
                msg = _parse_event_msg(payload, timestamp)
                if msg:
                    messages.append(msg)

    if not messages:
        return None

    # Derive title from thread metadata or first user message
    title = str(meta.get("title", ""))
    if not title or len(title) > 200:
        # title field in Codex is often the first_user_message verbatim
        title = str(meta.get("first_user_message", ""))
    if not title:
        for msg in messages:
            if msg.role == "user":
                title = msg.content[:120]
                break
    if not title:
        title = f"Codex session {thread_id[:8]}"

    # Truncate overly long titles
    if len(title) > 120:
        title = title[:117] + "..."

    created_at = _unix_to_iso(meta.get("created_at", 0))
    updated_at = _unix_to_iso(meta.get("updated_at", 0))
    model_provider = str(meta.get("model_provider", ""))
    model = str(meta.get("model", session_model))

    assistant_models = _collect_assistant_models(messages)
    if model and model not in assistant_models:
        assistant_models.insert(0, model)

    return ChatConversation(
        provider="codex",
        conversation_id=thread_id,
        canonical_id=f"codex-{thread_id}",
        title=title,
        created_at=created_at,
        updated_at=updated_at,
        assistant_models=assistant_models,
        messages=messages,
    )


def _parse_response_item(
    payload: dict[str, Any],
    timestamp: str,
    session_model: str,
) -> ChatMessage | None:
    """Parse a response_item event into a ChatMessage."""
    role = payload.get("role")
    item_type = payload.get("type", "")

    # User or assistant messages
    if role in ("user", "assistant"):
        content = _extract_content(payload)
        if not content:
            return None
        return ChatMessage(
            role=role,
            content=content,
            timestamp=timestamp,
            model=session_model if role == "assistant" else "",
        )

    # Tool calls — include as tool role for completeness
    if payload.get("name") and payload.get("call_id"):
        name = payload["name"]
        args = str(payload.get("arguments", ""))
        # Truncate very long tool args
        if len(args) > 500:
            args = args[:497] + "..."
        return ChatMessage(
            role="tool",
            content=f"[tool_call: {name}]\n{args}",
            timestamp=timestamp,
        )

    # Tool results — skip, they're typically verbose output
    return None


def _parse_event_msg(
    payload: dict[str, Any],
    timestamp: str,
) -> ChatMessage | None:
    """Parse an event_msg with user-visible content."""
    msg_type = payload.get("type", "")
    # User input events
    if msg_type == "user_input":
        text = str(payload.get("message", ""))
        if text:
            return ChatMessage(role="user", content=text, timestamp=timestamp)
    return None


def _extract_content(payload: dict[str, Any]) -> str:
    """Extract text content from a response_item payload."""
    content = payload.get("content")
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text", "")
                if text:
                    parts.append(str(text))
            elif isinstance(item, str):
                parts.append(item)
        return "\n\n".join(parts)

    return ""


def _collect_assistant_models(messages: list[ChatMessage]) -> list[str]:
    models: list[str] = []
    for msg in messages:
        if msg.role == "assistant" and msg.model and msg.model not in models:
            models.append(msg.model)
    return models


def _unix_to_iso(ts: int | float) -> str:
    if not ts:
        return ""
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    except (ValueError, OSError):
        return ""

"""OpenCode session normalization.

Reads session, message, and part data from the OpenCode SQLite database
at ~/.local/share/opencode/opencode.db.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..models import ChatConversation, ChatMessage

DEFAULT_DB = Path.home() / ".local" / "share" / "opencode" / "opencode.db"


def parse_opencode_sessions(
    db_path: Path = DEFAULT_DB,
    *,
    since: datetime | None = None,
) -> list[ChatConversation]:
    """Parse all OpenCode sessions into normalized conversations.

    Args:
        db_path: Path to opencode.db
        since: Only include sessions updated after this time (UTC)
    """
    if not db_path.exists():
        return []

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
    except sqlite3.Error:
        return []

    try:
        return _load_sessions(conn, since)
    finally:
        conn.close()


def _load_sessions(
    conn: sqlite3.Connection,
    since: datetime | None,
) -> list[ChatConversation]:
    """Load all sessions with their messages and parts."""
    query = (
        "SELECT id, title, directory, time_created, time_updated "
        "FROM session ORDER BY time_updated DESC"
    )
    sessions = conn.execute(query).fetchall()

    conversations: list[ChatConversation] = []
    for session in sessions:
        updated_ms = session["time_updated"]
        if since and updated_ms < since.timestamp() * 1000:
            continue

        messages = _load_messages(conn, session["id"])
        if not messages:
            continue

        title = session["title"] or f"OpenCode session {session['id'][:8]}"
        if len(title) > 120:
            title = title[:117] + "..."

        conversations.append(
            ChatConversation(
                provider="opencode",
                conversation_id=session["id"],
                canonical_id=f"opencode-{session['id']}",
                title=title,
                created_at=_ms_to_iso(session["time_created"]),
                updated_at=_ms_to_iso(session["time_updated"]),
                assistant_models=_collect_models(messages),
                messages=messages,
            )
        )

    return conversations


def _load_messages(
    conn: sqlite3.Connection,
    session_id: str,
) -> list[ChatMessage]:
    """Load messages and their parts for a session."""
    msg_rows = conn.execute(
        "SELECT id, data, time_created FROM message "
        "WHERE session_id = ? ORDER BY time_created, id",
        (session_id,),
    ).fetchall()

    messages: list[ChatMessage] = []
    for msg_row in msg_rows:
        try:
            msg_data = json.loads(msg_row["data"])
        except (json.JSONDecodeError, TypeError):
            continue

        role = msg_data.get("role", "user")

        # Load parts for this message (actual content)
        part_rows = conn.execute(
            "SELECT data FROM part WHERE message_id = ? ORDER BY id",
            (msg_row["id"],),
        ).fetchall()

        content_parts: list[str] = []
        for part_row in part_rows:
            try:
                part_data = json.loads(part_row["data"])
            except (json.JSONDecodeError, TypeError):
                continue
            text = _extract_part_text(part_data)
            if text:
                content_parts.append(text)

        content = "\n\n".join(content_parts)
        if not content:
            continue

        model = _extract_model(msg_data)
        agent = msg_data.get("agent", "")
        if agent and model:
            model = f"{model} ({agent})"
        elif agent:
            model = agent

        messages.append(
            ChatMessage(
                role=_normalize_role(role),
                content=content,
                timestamp=_ms_to_iso(msg_row["time_created"]),
                model=model if role == "assistant" else "",
            )
        )

    return messages


def _extract_part_text(part_data: dict[str, Any]) -> str:
    """Extract text from a message part."""
    part_type = part_data.get("type", "")

    if part_type == "text":
        return str(part_data.get("text", ""))

    if part_type == "tool-invocation":
        name = part_data.get("toolName", "")
        args = part_data.get("args", {})
        result = part_data.get("result", "")
        # Compact representation of tool calls
        args_str = json.dumps(args) if isinstance(args, dict) else str(args)
        if len(args_str) > 500:
            args_str = args_str[:497] + "..."
        parts = [f"[tool: {name}]"]
        if args_str and args_str != "{}":
            parts.append(args_str)
        if result:
            result_str = str(result)
            if len(result_str) > 500:
                result_str = result_str[:497] + "..."
            parts.append(f"→ {result_str}")
        return "\n".join(parts)

    if part_type == "reasoning":
        return str(part_data.get("text", ""))

    return ""


def _extract_model(msg_data: dict[str, Any]) -> str:
    """Extract model identifier from message metadata."""
    model_info = msg_data.get("model", {})
    if isinstance(model_info, dict):
        return str(model_info.get("modelID", ""))
    return str(model_info) if model_info else ""


def _normalize_role(role: str) -> str:
    role = role.strip().lower()
    if role in ("user", "assistant", "system", "tool"):
        return role
    return "user"


def _collect_models(messages: list[ChatMessage]) -> list[str]:
    models: list[str] = []
    for msg in messages:
        if msg.role == "assistant" and msg.model and msg.model not in models:
            models.append(msg.model)
    return models


def _ms_to_iso(ts_ms: int | float) -> str:
    """Convert millisecond timestamp to ISO 8601 UTC string."""
    if not ts_ms:
        return ""
    try:
        return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    except (ValueError, OSError):
        return ""

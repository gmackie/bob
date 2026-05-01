"""Claude CLI session normalization.

Claude Code CLI stores one JSONL file per session under:
    ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl

Each line is an event. The interesting types are:
- `user`:      {role: "user", content: str or [{type: "text", text: ...}]}
- `assistant`: {role: "assistant", content: [{type: "text", text}, ...], model: ...}

Plus metadata lines like `file-history-snapshot` that we skip.
Sidechain messages (isSidechain=True) are from subagents — we include them
so the conversation reflects the full work done.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from ..models import ChatConversation, ChatMessage

DEFAULT_CLAUDE_DIR = Path.home() / ".claude"


def parse_claude_cli_sessions(
    claude_dir: Path = DEFAULT_CLAUDE_DIR,
    *,
    since: datetime | None = None,
) -> list[ChatConversation]:
    """Parse all Claude CLI session transcripts into normalized conversations.

    Args:
        claude_dir: Path to ~/.claude/
        since: Only include sessions with mtime after this time (UTC)
    """
    projects_dir = claude_dir / "projects"
    if not projects_dir.exists():
        return []

    session_files = sorted(projects_dir.glob("*/*.jsonl"))

    conversations: list[ChatConversation] = []
    for path in session_files:
        if since:
            try:
                mtime = path.stat().st_mtime
                if mtime < since.timestamp():
                    continue
            except OSError:
                continue

        try:
            conversation = _parse_session(path)
            if conversation and conversation.messages:
                conversations.append(conversation)
        except Exception:
            continue

    return conversations


def _parse_session(path: Path) -> ChatConversation | None:
    """Parse a single session JSONL file into a ChatConversation."""
    session_id = path.stem
    messages: list[ChatMessage] = []
    first_ts = ""
    last_ts = ""
    cwd = ""
    git_branch = ""

    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Capture session context from any event
            if not cwd:
                cwd = str(event.get("cwd", ""))
            if not git_branch:
                git_branch = str(event.get("gitBranch", ""))

            event_type = event.get("type", "")
            if event_type not in ("user", "assistant"):
                continue

            # Skip meta/hidden messages (tool results embedded as user messages,
            # command invocations, etc.) — but keep real user prompts
            if event.get("isMeta") is True:
                continue

            msg = _parse_message_event(event)
            if not msg:
                continue

            messages.append(msg)
            ts = str(event.get("timestamp", ""))
            if ts and not first_ts:
                first_ts = ts
            if ts:
                last_ts = ts

    if not messages:
        return None

    # Derive title from first non-system user message
    title = ""
    for msg in messages:
        if msg.role == "user" and msg.content and not msg.content.startswith("<"):
            title = msg.content[:120]
            break
    if not title and messages:
        title = messages[0].content[:120]
    if not title:
        title = f"Claude CLI session {session_id[:8]}"
    # Clean up title: single line, trimmed
    title = title.split("\n", 1)[0].strip()
    if len(title) > 120:
        title = title[:117] + "..."

    assistant_models = _collect_models(messages)

    return ChatConversation(
        provider="claude-cli",
        conversation_id=session_id,
        canonical_id=f"claude-cli-{session_id}",
        title=title or "(untitled Claude session)",
        created_at=first_ts,
        updated_at=last_ts,
        assistant_models=assistant_models,
        messages=messages,
    )


def _parse_message_event(event: dict[str, Any]) -> ChatMessage | None:
    """Extract a ChatMessage from a user/assistant event."""
    msg = event.get("message")
    if not isinstance(msg, dict):
        return None

    role = str(msg.get("role") or event.get("type") or "")
    if role not in ("user", "assistant"):
        return None

    content = _extract_content(msg.get("content"))
    if not content:
        return None

    # Skip bracketed command/tool-result markers that aren't real conversation
    stripped = content.strip()
    if stripped.startswith("<command-") or stripped.startswith("[Request"):
        return None
    if stripped.startswith("<local-command-stdout>"):
        return None

    return ChatMessage(
        role=role,
        content=content,
        timestamp=str(event.get("timestamp", "")),
        model=str(msg.get("model", "")) if role == "assistant" else "",
    )


def _extract_content(content: Any) -> str:
    """Flatten Claude's content field (str or list of typed parts) to text."""
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                item_type = item.get("type", "")
                if item_type == "text":
                    text = item.get("text", "")
                    if text:
                        parts.append(str(text))
                elif item_type == "tool_use":
                    name = item.get("name", "")
                    tool_input = item.get("input", {})
                    input_str = (
                        json.dumps(tool_input)
                        if isinstance(tool_input, dict)
                        else str(tool_input)
                    )
                    if len(input_str) > 500:
                        input_str = input_str[:497] + "..."
                    parts.append(f"[tool: {name}] {input_str}")
                elif item_type == "tool_result":
                    result = item.get("content", "")
                    if isinstance(result, list):
                        result = " ".join(
                            str(r.get("text", "")) for r in result if isinstance(r, dict)
                        )
                    result_str = str(result)
                    if len(result_str) > 500:
                        result_str = result_str[:497] + "..."
                    parts.append(f"[tool_result] {result_str}")
            elif isinstance(item, str):
                parts.append(item)
        return "\n\n".join(parts).strip()

    return ""


def _collect_models(messages: list[ChatMessage]) -> list[str]:
    models: list[str] = []
    for msg in messages:
        if msg.role == "assistant" and msg.model and msg.model not in models:
            models.append(msg.model)
    return models

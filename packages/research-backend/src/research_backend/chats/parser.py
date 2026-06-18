"""Parse exported chats from ChatGPT, Claude, and Grok."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import ChatConversation, ChatMessage
from .providers import parse_chatgpt_export, parse_claude_export, parse_grok_export


def detect_provider(path: Path) -> str:
    """Infer the chat provider from the export structure."""
    data = _load_json(path)
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            if "chat_messages" in first:
                return "claude"
            if "mapping" in first and (
                "conversation_id" in first or "id" in first
            ):
                return "chatgpt"
            if "messages" in first and "thread_id" in first:
                return "grok"
    if isinstance(data, dict) and "conversations" in data:
        return "chatgpt"
    if isinstance(data, dict) and "chat_messages" in data:
        return "claude"
    if isinstance(data, dict) and "threads" in data:
        return "grok"
    raise ValueError(f"Unsupported chat export format: {path}")


def parse_export(path: Path) -> list[ChatConversation]:
    """Parse a provider export into normalized conversations."""
    provider = detect_provider(path)
    data = _load_json(path)

    if provider == "chatgpt":
        return parse_chatgpt_export(data)
    if provider == "claude":
        return parse_claude_export(data)
    if provider == "grok":
        return parse_grok_export(data)

    raise NotImplementedError(f"Parsing not implemented for provider: {provider}")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

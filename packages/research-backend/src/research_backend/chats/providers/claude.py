"""Claude export normalization."""

from __future__ import annotations

import hashlib
from typing import Any

from ..models import ChatAttachment, ChatConversation, ChatMessage


def parse_claude_export(data: Any) -> list[ChatConversation]:
    if isinstance(data, list):
        conversations = data
    elif isinstance(data, dict):
        conversations = data.get("chat_messages") or []
    else:
        conversations = []
    normalized: list[ChatConversation] = []

    for conv in conversations:
        raw_messages = conv.get("messages") or conv.get("chat_messages") or []
        messages = [
            ChatMessage(
                role=_normalize_role(message.get("role") or message.get("sender", "")),
                content=_extract_message_text(message),
                timestamp=str(message.get("timestamp") or message.get("created_at") or ""),
                model=str(message.get("model", "")),
                attachments=_parse_attachments(message.get("attachments")),
            )
            for message in raw_messages
        ]
        conversation_id = str(conv.get("id") or conv.get("uuid") or "").strip() or _fallback_conversation_id(conv, messages)
        normalized.append(
            ChatConversation(
                provider="claude",
                conversation_id=conversation_id,
                canonical_id=f"claude-{conversation_id}",
                title=str(conv.get("title") or conv.get("name") or "(untitled)"),
                created_at=str(conv.get("created_at", "")),
                updated_at=str(conv.get("updated_at", "")),
                assistant_models=_collect_assistant_models(messages),
                messages=messages,
            )
        )

    return normalized


def _normalize_role(role: Any) -> str:
    value = str(role or "").strip().lower()
    if value == "human":
        return "user"
    if value in {"assistant", "user", "system", "tool"}:
        return value
    return value or "user"


def _collect_assistant_models(messages: list[ChatMessage]) -> list[str]:
    models: list[str] = []
    for message in messages:
        if message.role != "assistant":
            continue
        if message.model and message.model not in models:
            models.append(message.model)
    return models


def _fallback_conversation_id(conv: dict[str, Any], messages: list[ChatMessage]) -> str:
    digest = hashlib.sha256()
    digest.update(str(conv.get("title", "")).encode("utf-8"))
    for message in messages[:3]:
        digest.update(message.role.encode("utf-8"))
        digest.update(message.timestamp.encode("utf-8"))
        digest.update(message.content.encode("utf-8"))
    return digest.hexdigest()[:12]


def _parse_attachments(raw_attachments: Any) -> list[ChatAttachment]:
    if not isinstance(raw_attachments, list):
        return []

    attachments: list[ChatAttachment] = []
    for attachment in raw_attachments:
        if not isinstance(attachment, dict):
            continue
        attachments.append(
            ChatAttachment(
                kind=str(
                    attachment.get("kind")
                    or attachment.get("type")
                    or "file"
                ),
                name=str(
                    attachment.get("name")
                    or attachment.get("file_name")
                    or ""
                ),
                status=str(attachment.get("status", "referenced_only") or "referenced_only"),
                mime_type=str(
                    attachment.get("mime_type")
                    or attachment.get("file_type")
                    or ""
                ),
                url=str(
                    attachment.get("url")
                    or attachment.get("preview_url")
                    or ""
                ),
            )
        )
    return attachments


def _extract_message_text(message: dict[str, Any]) -> str:
    text = str(message.get("text") or "").strip()
    if text:
        return text
    content = message.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text" and item.get("text"):
            parts.append(str(item["text"]))
        elif item.get("type") == "thinking" and item.get("thinking"):
            parts.append(str(item["thinking"]))
    return "\n\n".join(parts)

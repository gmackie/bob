"""ChatGPT export normalization."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from ..models import ChatAttachment, ChatConversation, ChatMessage


def parse_chatgpt_export(data: Any) -> list[ChatConversation]:
    if isinstance(data, list):
        conversations = data
    elif isinstance(data, dict):
        conversations = data.get("conversations") or []
    else:
        conversations = []
    normalized: list[ChatConversation] = []

    for conv in conversations:
        normalized.append(_normalize_conversation(conv))

    return normalized


def _normalize_conversation(conv: dict[str, Any]) -> ChatConversation:
    if isinstance(conv.get("mapping"), dict):
        messages = _parse_mapping_messages(conv)
    else:
        messages = [
            ChatMessage(
                role=_normalize_role(message.get("role", "")),
                content=str(message.get("content", "")),
                timestamp=str(message.get("timestamp", "")),
                model=str(message.get("model", "")),
                attachments=_parse_attachments(message.get("attachments")),
            )
            for message in conv.get("messages", [])
        ]
    assistant_models = _collect_assistant_models(messages)
    conversation_id = str(
        conv.get("conversation_id") or conv.get("id") or ""
    ).strip()
    if not conversation_id:
        conversation_id = _fallback_conversation_id(conv, messages)

    return ChatConversation(
        provider="chatgpt",
        conversation_id=conversation_id,
        canonical_id=f"chatgpt-{conversation_id}",
        title=str(conv.get("title") or "(untitled)"),
        created_at=_normalize_timestamp(
            conv.get("created_at") or conv.get("create_time")
        ),
        updated_at=_normalize_timestamp(
            conv.get("updated_at") or conv.get("update_time")
        ),
        assistant_models=assistant_models,
        messages=messages,
    )


def _normalize_role(role: Any) -> str:
    value = str(role or "").strip().lower()
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
    digest.update(str(conv.get("created_at", "")).encode("utf-8"))
    digest.update(str(conv.get("updated_at", "")).encode("utf-8"))
    for message in messages[:3]:
        digest.update(message.role.encode("utf-8"))
        digest.update(message.timestamp.encode("utf-8"))
        digest.update(message.content.encode("utf-8"))
        digest.update(message.model.encode("utf-8"))
    return digest.hexdigest()[:12]


def _parse_mapping_messages(conv: dict[str, Any]) -> list[ChatMessage]:
    mapping = conv.get("mapping") or {}
    parsed: list[tuple[float, ChatMessage]] = []
    for node in mapping.values():
        if not isinstance(node, dict):
            continue
        raw_message = node.get("message")
        if not isinstance(raw_message, dict):
            continue
        author = raw_message.get("author") or {}
        content = raw_message.get("content") or {}
        parts = content.get("parts") if isinstance(content, dict) else None
        text = (
            "\n\n".join(str(part) for part in parts if part)
            if isinstance(parts, list)
            else ""
        )
        created = raw_message.get("create_time")
        parsed.append(
            (
                float(created or 0.0),
                ChatMessage(
                    role=_normalize_role(author.get("role", "")),
                    content=text,
                    timestamp=_normalize_timestamp(created),
                    model=str(
                        (raw_message.get("metadata") or {}).get("model_slug", "")
                    ),
                ),
            )
        )
    parsed.sort(key=lambda row: row[0])
    return [message for _, message in parsed]


def _normalize_timestamp(value: Any) -> str:
    if value in (None, ""):
        return ""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    return str(value)


def _parse_attachments(raw_attachments: Any) -> list[ChatAttachment]:
    if not isinstance(raw_attachments, list):
        return []

    attachments: list[ChatAttachment] = []
    for attachment in raw_attachments:
        if not isinstance(attachment, dict):
            continue
        attachments.append(
            ChatAttachment(
                kind=str(attachment.get("kind", "file") or "file"),
                name=str(attachment.get("name", "") or ""),
                status=str(attachment.get("status", "referenced_only") or "referenced_only"),
                mime_type=str(attachment.get("mime_type", "") or ""),
                url=str(attachment.get("url", "") or ""),
            )
        )
    return attachments

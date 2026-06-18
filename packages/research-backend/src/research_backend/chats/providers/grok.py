"""Grok export normalization."""

from __future__ import annotations

import hashlib
from typing import Any

from ..models import ChatAttachment, ChatConversation, ChatMessage


def parse_grok_export(data: dict[str, Any]) -> list[ChatConversation]:
    threads = data.get("threads") or []
    normalized: list[ChatConversation] = []

    for thread in threads:
        messages = [
            ChatMessage(
                role=_normalize_role(message.get("role", "")),
                content=str(message.get("content", "")),
                timestamp=str(message.get("timestamp", "")),
                model=str(message.get("model", "")),
                attachments=_parse_attachments(message.get("attachments")),
            )
            for message in thread.get("messages", [])
        ]
        conversation_id = str(thread.get("id") or "").strip() or _fallback_conversation_id(thread, messages)
        normalized.append(
            ChatConversation(
                provider="grok",
                conversation_id=conversation_id,
                canonical_id=f"grok-{conversation_id}",
                title=str(thread.get("title") or "(untitled)"),
                created_at=str(thread.get("created_at", "")),
                updated_at=str(thread.get("updated_at", "")),
                assistant_models=_collect_assistant_models(messages),
                messages=messages,
            )
        )

    return normalized


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


def _fallback_conversation_id(thread: dict[str, Any], messages: list[ChatMessage]) -> str:
    digest = hashlib.sha256()
    digest.update(str(thread.get("title", "")).encode("utf-8"))
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
                kind=str(attachment.get("kind", "file") or "file"),
                name=str(attachment.get("name", "") or ""),
                status=str(attachment.get("status", "referenced_only") or "referenced_only"),
                mime_type=str(attachment.get("mime_type", "") or ""),
                url=str(attachment.get("url", "") or ""),
            )
        )
    return attachments

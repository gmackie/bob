"""Render normalized chat conversations as markdown source notes."""

from __future__ import annotations

from pathlib import Path

import yaml

from .models import ChatConversation


def conversation_note_path(raw_dir: Path, canonical_id: str) -> Path:
    """Resolve the on-disk path for a conversation note."""
    safe = canonical_id.replace("/", "-").replace("\\", "-").replace("..", "-")
    return raw_dir / f"{safe}.md"


def render_note(conversation: ChatConversation) -> str:
    """Render a normalized conversation as a markdown source note."""
    attachments = [
        {
            "kind": attachment.kind,
            "name": attachment.name,
            "status": attachment.status,
            "mime_type": attachment.mime_type,
            "url": attachment.url,
        }
        for message in conversation.messages
        for attachment in message.attachments
    ]

    frontmatter = {
        "source_type": "chat_conversation",
        "provider": conversation.provider,
        "conversation_id": conversation.conversation_id,
        "canonical_id": conversation.canonical_id,
        "title": conversation.title or "(untitled)",
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "message_count": conversation.message_count,
        "assistant_models": list(conversation.assistant_models),
        "attachments": attachments,
    }
    frontmatter_yaml = yaml.safe_dump(
        frontmatter,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=10_000,
    ).rstrip()

    parts = [
        f"---\n{frontmatter_yaml}\n---",
        "",
        f"# {conversation.title or '(untitled)'}",
        "",
        "## Summary",
        "",
        f"- Provider: {conversation.provider}",
        f"- Conversation ID: {conversation.conversation_id}",
        f"- Messages: {conversation.message_count}",
    ]

    if conversation.created_at:
        parts.append(f"- Created: {conversation.created_at}")
    if conversation.updated_at:
        parts.append(f"- Updated: {conversation.updated_at}")
    if conversation.assistant_models:
        parts.append(
            "- Assistant models: " + ", ".join(conversation.assistant_models)
        )

    parts.extend(["", "## Transcript", ""])
    for message in conversation.messages:
        parts.append(f"### {message.role}")
        parts.append("")
        parts.append(message.content or "")
        if message.timestamp:
            parts.append("")
            parts.append(f"- Timestamp: {message.timestamp}")
        if message.model:
            parts.append(f"- Model: {message.model}")
        if message.attachments:
            parts.append("- Attachments:")
            for attachment in message.attachments:
                details = f"{attachment.kind}: {attachment.name}"
                if attachment.mime_type:
                    details += f" ({attachment.mime_type})"
                if attachment.url:
                    details += f" [{attachment.url}]"
                parts.append(f"  - {details}")
        parts.append("")

    return "\n".join(parts).rstrip() + "\n"

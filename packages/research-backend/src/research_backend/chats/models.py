"""Normalized chat export data models."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ChatAttachment:
    kind: str
    name: str
    status: str = "referenced_only"
    mime_type: str = ""
    url: str = ""


@dataclass
class ChatMessage:
    role: str
    content: str
    timestamp: str = ""
    model: str = ""
    attachments: list[ChatAttachment] = field(default_factory=list)


@dataclass
class ChatConversation:
    provider: str
    conversation_id: str
    canonical_id: str
    title: str
    created_at: str = ""
    updated_at: str = ""
    assistant_models: list[str] = field(default_factory=list)
    messages: list[ChatMessage] = field(default_factory=list)

    @property
    def message_count(self) -> int:
        return len(self.messages)

"""Import conversations from local coding agents (Codex, Claude CLI, OpenCode).

Unlike the file-based importer which processes exported JSON/ZIP files,
this module reads directly from the agents' local data stores on disk.
It reuses the same manifest and note-writing pipeline so agent conversations
appear alongside ChatGPT/Claude/Grok exports in sources/chats/raw/.
"""

from __future__ import annotations

import datetime
import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .manifest import (
    append_conversation,
    append_import_finished,
    append_import_started,
    iter_events,
    known_import_ids,
    manifest_path,
)
from .models import ChatConversation
from .notes import conversation_note_path, render_note
from .providers.claude_cli import parse_claude_cli_sessions
from .providers.codex import parse_codex_sessions
from .providers.opencode import parse_opencode_sessions


@dataclass
class AgentImportReport:
    provider: str
    import_id: str
    conversations_parsed: int = 0
    conversations_created: int = 0
    conversations_updated: int = 0
    conversations_skipped: int = 0
    errors: list[str] = field(default_factory=list)
    skipped_reason: str = ""


def import_all_agents(
    sources_root: Path,
    *,
    dry_run: bool = False,
    progress: Callable[[str], None] | None = None,
) -> list[AgentImportReport]:
    """Import from all available local agent data stores."""
    reports: list[AgentImportReport] = []
    log = progress or (lambda msg: None)

    log("=== Importing local agent conversations ===")

    # Codex
    log("\n[codex] Scanning ~/.codex/sessions/...")
    report = import_agent_conversations(
        provider="codex",
        parser=lambda since: parse_codex_sessions(since=since),
        sources_root=sources_root,
        dry_run=dry_run,
        progress=progress,
    )
    reports.append(report)

    # Claude CLI
    log("\n[claude-cli] Scanning ~/.claude/transcripts/...")
    report = import_agent_conversations(
        provider="claude-cli",
        parser=lambda since: parse_claude_cli_sessions(since=since),
        sources_root=sources_root,
        dry_run=dry_run,
        progress=progress,
    )
    reports.append(report)

    # OpenCode
    log("\n[opencode] Scanning ~/.local/share/opencode/opencode.db...")
    report = import_agent_conversations(
        provider="opencode",
        parser=lambda since: parse_opencode_sessions(since=since),
        sources_root=sources_root,
        dry_run=dry_run,
        progress=progress,
    )
    reports.append(report)

    return reports


def import_agent_conversations(
    provider: str,
    parser: Callable[[datetime.datetime | None], list[ChatConversation]],
    sources_root: Path,
    *,
    dry_run: bool = False,
    progress: Callable[[str], None] | None = None,
) -> AgentImportReport:
    """Import conversations from a single agent provider.

    Uses conversation-level idempotency: each conversation's canonical_id
    is checked against the manifest. Only new or updated conversations
    are written. This differs from the file-based importer which uses
    import-level idempotency (hash of the export file).
    """
    log = progress or (lambda msg: None)
    raw_dir = sources_root / "raw"
    manifest_file = manifest_path(sources_root)

    if not dry_run:
        raw_dir.mkdir(parents=True, exist_ok=True)

    # Generate a date-scoped import ID for this sync run
    now = datetime.datetime.now(datetime.timezone.utc)
    import_id = f"{now.strftime('%Y-%m-%d')}-agent-{provider}"
    report = AgentImportReport(provider=provider, import_id=import_id)

    # Find the last successful sync time for incremental imports
    last_sync = _last_agent_sync(manifest_file, provider)

    if not dry_run:
        append_import_started(
            manifest_file, import_id=import_id, source=f"agent:{provider}"
        )

    # Parse conversations from the agent's data store
    try:
        conversations = parser(last_sync)
    except Exception as exc:
        report.errors.append(f"parse failed: {exc}")
        log(f"  [error] parse failed: {exc}")
        return report

    report.conversations_parsed = len(conversations)
    log(f"  Parsed {len(conversations)} conversation(s).")

    # Get known canonical IDs to detect updates vs creates
    known_ids = _known_canonical_ids(manifest_file)

    for conversation in conversations:
        note_path = conversation_note_path(raw_dir, conversation.canonical_id)
        existed = conversation.canonical_id in known_ids or note_path.exists()

        try:
            rendered = render_note(conversation)
            if not dry_run:
                tmp_path = note_path.with_suffix(note_path.suffix + ".tmp")
                tmp_path.write_text(rendered, encoding="utf-8")
                tmp_path.replace(note_path)
                append_conversation(
                    manifest_file,
                    canonical_id=conversation.canonical_id,
                    provider=conversation.provider,
                    import_id=import_id,
                )
            if existed:
                report.conversations_updated += 1
            else:
                report.conversations_created += 1
        except OSError as exc:
            msg = f"write failed for {conversation.canonical_id}: {exc}"
            report.errors.append(msg)
            log(f"  [error] {msg}")

    total = report.conversations_created + report.conversations_updated
    if not dry_run and not report.errors:
        append_import_finished(
            manifest_file, import_id=import_id, conversations=total
        )

    log(
        f"  Done: {report.conversations_created} created, "
        f"{report.conversations_updated} updated, "
        f"{len(report.errors)} errors."
    )
    return report


def _last_agent_sync(
    manifest_file: Path,
    provider: str,
) -> datetime.datetime | None:
    """Find the timestamp of the last successful agent sync for this provider."""
    last_finished_at: str | None = None
    for event in iter_events(manifest_file):
        if (
            event.get("kind") == "import_finished"
            and event.get("import_id", "").endswith(f"-agent-{provider}")
        ):
            last_finished_at = event.get("finished_at")

    if not last_finished_at:
        return None

    try:
        return datetime.datetime.fromisoformat(
            last_finished_at.replace("Z", "+00:00")
        )
    except (ValueError, AttributeError):
        return None


def _known_canonical_ids(manifest_file: Path) -> set[str]:
    """Collect all canonical IDs that have been previously imported."""
    ids: set[str] = set()
    for event in iter_events(manifest_file):
        if event.get("kind") == "conversation":
            cid = event.get("canonical_id")
            if cid:
                ids.add(str(cid))
    return ids

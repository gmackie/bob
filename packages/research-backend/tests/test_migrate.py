from pathlib import Path
from textwrap import dedent

from research_backend.migrate import (
    compute_content_hash,
    parse_frontmatter,
    scan_chat_sources,
)


def test_compute_content_hash_is_stable():
    h1 = compute_content_hash("hello world")
    h2 = compute_content_hash("hello world")
    assert h1 == h2
    assert len(h1) == 64  # sha256 hex


def test_parse_frontmatter_extracts_yaml():
    text = dedent("""\
        ---
        title: Test Chat
        provider: claude
        ---
        This is the body.
    """)
    meta, body = parse_frontmatter(text)
    assert meta is not None
    assert meta["title"] == "Test Chat"
    assert meta["provider"] == "claude"
    assert "This is the body." in body


def test_parse_frontmatter_handles_no_frontmatter():
    text = "Just some text."
    meta, body = parse_frontmatter(text)
    assert meta is None
    assert body == text


def test_scan_chat_sources_reads_markdown(tmp_path: Path):
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "convo-001.md").write_text(
        dedent("""\
            ---
            title: Test Conversation
            provider: chatgpt
            created_at: "2026-01-15"
            ---
            User: Hello
            Assistant: Hi there!
        """)
    )

    records = scan_chat_sources(tmp_path)
    assert len(records) == 1
    assert records[0].kind == "chat"
    assert records[0].external_id == "convo-001"
    assert records[0].title == "Test Conversation"
    assert records[0].author == "chatgpt"
    assert len(records[0].content_hash) == 64

"""Tests for compile_sources module: source loading, filtering, truncation, batching."""


from research_backend.compile_sources import (
    batch_sources,
    matches_filter,
    parse_frontmatter,
    read_external_source_chunks,
    read_source_chunks,
    smart_truncate,
    smart_truncate_external,
    source_chunk_id,
)

# ---------- parse_frontmatter ----------


def test_parse_frontmatter_extracts_yaml():
    text = "---\ntitle: Hello\nchannel: Huberman\n---\nBody text here"
    fm = parse_frontmatter(text)
    assert fm["title"] == "Hello"
    assert fm["channel"] == "Huberman"


def test_parse_frontmatter_no_frontmatter():
    assert parse_frontmatter("Just some text") == {}


def test_parse_frontmatter_incomplete_fence():
    assert parse_frontmatter("---\ntitle: Missing end") == {}


def test_parse_frontmatter_non_dict_yaml():
    text = "---\n- item1\n- item2\n---\nBody"
    assert parse_frontmatter(text) == {}


def test_parse_frontmatter_invalid_yaml():
    text = "---\n: : : bad\n---\nBody"
    # Should not raise, returns {}
    assert parse_frontmatter(text) == {}


# ---------- matches_filter ----------


def test_matches_filter_substring_match():
    fm = {"channel": "Andrew Huberman Lab", "source_type": "youtube_video"}
    assert matches_filter(fm, {"channel": "huberman"}) is True


def test_matches_filter_case_insensitive():
    fm = {"channel": "Andrew Huberman Lab"}
    assert matches_filter(fm, {"channel": "HUBERMAN"}) is True


def test_matches_filter_missing_key_rejects():
    fm = {"title": "Something"}
    assert matches_filter(fm, {"channel": "huberman"}) is False


def test_matches_filter_no_match_rejects():
    fm = {"channel": "Lex Fridman Podcast"}
    assert matches_filter(fm, {"channel": "huberman"}) is False


def test_matches_filter_empty_rules_passes():
    fm = {"anything": "value"}
    assert matches_filter(fm, {}) is True


def test_matches_filter_multiple_rules_all_must_match():
    fm = {"channel": "Huberman Lab", "source_type": "youtube_video"}
    assert matches_filter(fm, {"channel": "huberman", "source_type": "youtube"}) is True
    assert matches_filter(fm, {"channel": "huberman", "source_type": "chat"}) is False


def test_matches_filter_non_string_values_coerced():
    fm = {"year": 2024}
    assert matches_filter(fm, {"year": "2024"}) is True


# ---------- smart_truncate ----------


def test_smart_truncate_under_limit_unchanged():
    text = "short text"
    assert smart_truncate(text) == text


def test_smart_truncate_at_limit_unchanged():
    text = "x" * 10000
    assert smart_truncate(text) == text


def test_smart_truncate_over_limit_appends_marker():
    text = "x" * 15000
    result = smart_truncate(text)
    assert len(result) < len(text)
    assert result.endswith("[... truncated, source continues ...]")
    # First 10K chars preserved
    assert result.startswith("x" * 10000)


# ---------- smart_truncate_external ----------


def test_smart_truncate_external_under_limit_unchanged():
    text = "Short external source."
    assert smart_truncate_external(text, {}) == text


def test_smart_truncate_external_at_limit_unchanged():
    text = "x" * 12000
    assert smart_truncate_external(text, {}) == text


def test_smart_truncate_external_over_limit_no_transcript():
    text = "x" * 13000
    result = smart_truncate_external(text, {})
    assert result.endswith("[... source truncated ...]")
    assert len(result) < len(text)


def test_smart_truncate_external_preserves_transcript_header():
    # Build a note with a transcript section that exceeds 12K
    head = "---\ntitle: Test\n---\nSummary.\n\n"
    transcript_marker = "## Transcript"
    transcript_body = "word " * 5000  # ~25K chars
    text = head + transcript_marker + transcript_body

    result = smart_truncate_external(text, {"title": "Test"})
    assert "## Transcript" in result
    assert result.endswith("[... transcript truncated ...]")
    # Head is preserved
    assert result.startswith(head)


# ---------- source_chunk_id ----------


def test_source_chunk_id_extracts_header():
    chunk = "### SOURCE: my-doc.md\n\nContent here"
    assert source_chunk_id(chunk) == "### SOURCE: my-doc.md"


def test_source_chunk_id_with_source_type():
    chunk = "### SOURCE: video.md [source_type=youtube_video]\n\nContent"
    assert source_chunk_id(chunk) == "### SOURCE: video.md [source_type=youtube_video]"


def test_source_chunk_id_no_header_returns_full():
    chunk = "some random text"
    assert source_chunk_id(chunk) == chunk


def test_source_chunk_id_empty_string():
    assert source_chunk_id("") == ""


# ---------- batch_sources ----------


def test_batch_sources_respects_char_limit():
    chunks = ["a" * 100, "b" * 100, "c" * 100]
    batches = batch_sources(chunks, 250)
    assert len(batches) == 2
    assert batches[0] == ["a" * 100, "b" * 100]
    assert batches[1] == ["c" * 100]


def test_batch_sources_single_oversized_chunk():
    """A single chunk bigger than the limit still gets its own batch."""
    chunks = ["x" * 500]
    batches = batch_sources(chunks, 100)
    assert len(batches) == 1
    assert batches[0] == ["x" * 500]


def test_batch_sources_empty_input():
    assert batch_sources([], 100) == []


def test_batch_sources_exact_fit():
    chunks = ["a" * 50, "b" * 50]
    batches = batch_sources(chunks, 100)
    assert len(batches) == 1
    assert len(batches[0]) == 2


def test_batch_sources_each_chunk_one_batch():
    chunks = ["a" * 100, "b" * 100, "c" * 100]
    batches = batch_sources(chunks, 100)
    # First chunk fits in a batch alone, second starts new batch when combined would exceed
    # Actually: first chunk = 100, second chunk = 100, 100 + 100 > 100 so second starts new
    assert len(batches) == 3


# ---------- read_source_chunks (filesystem) ----------


def test_read_source_chunks_empty_dir(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    assert read_source_chunks(raw_dir) == []


def test_read_source_chunks_nonexistent_dir(tmp_path):
    raw_dir = tmp_path / "nonexistent"
    assert read_source_chunks(raw_dir) == []


def test_read_source_chunks_skips_unsupported(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "data.json").write_text('{"key": "val"}')
    (raw_dir / "image.png").write_bytes(b"\x89PNG")
    assert read_source_chunks(raw_dir) == []


# ---------- read_external_source_chunks (filesystem) ----------


def test_read_external_source_chunks_with_filter(tmp_path):
    ext_dir = tmp_path / "youtube_raw"
    ext_dir.mkdir()

    # Matching file
    (ext_dir / "vid1.md").write_text(
        "---\nchannel: Huberman Lab\nsource_type: youtube_video\n---\nTranscript text"
    )
    # Non-matching file
    (ext_dir / "vid2.md").write_text(
        "---\nchannel: Lex Fridman\nsource_type: youtube_video\n---\nOther transcript"
    )

    result = read_external_source_chunks(ext_dir, {"channel": "huberman"})
    assert len(result) == 1
    assert "vid1.md" in result[0]


def test_read_external_source_chunks_no_filter(tmp_path):
    ext_dir = tmp_path / "pool"
    ext_dir.mkdir()
    (ext_dir / "note.md").write_text("---\ntitle: Test\n---\nBody")

    result = read_external_source_chunks(ext_dir, {})
    assert len(result) == 1

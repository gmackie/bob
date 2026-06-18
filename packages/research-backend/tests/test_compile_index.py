"""Tests for compile_index module: article parsing, index building, logging."""


from research_backend.compile_index import (
    append_log,
    count_sources,
    extract_title,
    extract_type,
    parse_articles,
    rebuild_index,
    slugify,
    type_to_dir,
)
from research_backend.models import KBConfig

# ---------- extract_title ----------


def test_extract_title_from_yaml():
    content = "---\ntitle: Intermittent Fasting\ntype: concept\n---\n# Intermittent Fasting"
    assert extract_title(content) == "Intermittent Fasting"


def test_extract_title_quoted():
    content = '---\ntitle: "My Article"\n---\nBody'
    assert extract_title(content) == "My Article"


def test_extract_title_single_quoted():
    content = "---\ntitle: 'Another Article'\n---\nBody"
    assert extract_title(content) == "Another Article"


def test_extract_title_missing():
    content = "---\ntype: concept\n---\nBody"
    assert extract_title(content) == ""


# ---------- extract_type ----------


def test_extract_type_from_yaml():
    content = "---\ntitle: X\ntype: protocol\n---\nBody"
    assert extract_type(content) == "protocol"


def test_extract_type_default_concept():
    content = "---\ntitle: X\n---\nBody"
    assert extract_type(content) == "concept"


def test_extract_type_entity():
    content = "---\ntitle: OpenAI\ntype: entity\n---\nBody"
    assert extract_type(content) == "entity"


# ---------- type_to_dir ----------


def test_type_to_dir_concept():
    assert type_to_dir("concept") == "concepts"


def test_type_to_dir_protocol():
    assert type_to_dir("protocol") == "protocols"


def test_type_to_dir_entity():
    assert type_to_dir("entity") == "entities"


def test_type_to_dir_comparison_maps_to_concepts():
    assert type_to_dir("comparison") == "concepts"


def test_type_to_dir_unknown_defaults_to_concepts():
    assert type_to_dir("unknown_type") == "concepts"


# ---------- slugify ----------


def test_slugify_normalizes():
    assert slugify("Intermittent Fasting Protocols") == "intermittent-fasting-protocols"


def test_slugify_strips_special_chars():
    assert slugify("What's New? (2024)") == "whats-new-2024"


def test_slugify_truncates_at_80():
    long_title = "a " * 60  # 120 chars
    slug = slugify(long_title)
    assert len(slug) <= 80


def test_slugify_empty_returns_untitled():
    assert slugify("") == "untitled"


def test_slugify_only_special_chars():
    assert slugify("!!!") == "untitled"


def test_slugify_strips_leading_trailing_hyphens():
    assert slugify("-hello-") == "hello"


# ---------- parse_articles ----------


def test_parse_articles_splits_on_break():
    response = (
        "---\ntitle: Alpha\ntype: concept\n---\n# Alpha\nContent A\n"
        "---ARTICLE_BREAK---\n"
        "---\ntitle: Beta\ntype: protocol\n---\n# Beta\nContent B"
    )
    articles = parse_articles(response)
    assert len(articles) == 2
    assert articles[0][0] == "alpha"
    assert articles[1][0] == "beta"


def test_parse_articles_skips_empty_chunks():
    response = "---ARTICLE_BREAK---\n\n---ARTICLE_BREAK---"
    articles = parse_articles(response)
    assert len(articles) == 0


def test_parse_articles_skips_chunks_without_title():
    response = "---\ntype: concept\n---\nNo title here"
    articles = parse_articles(response)
    assert len(articles) == 0


def test_parse_articles_single_article():
    response = "---\ntitle: Solo\ntype: entity\n---\n# Solo\nContent"
    articles = parse_articles(response)
    assert len(articles) == 1
    assert articles[0][0] == "solo"
    assert "Solo" in articles[0][1]


# ---------- count_sources ----------


def test_count_sources_empty(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    assert count_sources(raw_dir) == 0


def test_count_sources_nonexistent(tmp_path):
    assert count_sources(tmp_path / "nope") == 0


def test_count_sources_mixed_files(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "paper.pdf").write_bytes(b"%PDF-1.4")
    (raw_dir / "notes.md").write_text("# Notes")
    (raw_dir / "data.json").write_text("{}")  # unsupported
    (raw_dir / "readme.txt").write_text("readme")
    assert count_sources(raw_dir) == 3


# ---------- rebuild_index ----------


def _make_config(name: str = "test-kb") -> KBConfig:
    return KBConfig(name=name, description="A test KB")


def test_rebuild_index_generates_markdown(tmp_path):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()

    # Create some articles
    concepts_dir = wiki_dir / "concepts"
    concepts_dir.mkdir()
    (concepts_dir / "fasting.md").write_text(
        "---\ntitle: Intermittent Fasting\ntype: concept\n---\n# Intermittent Fasting"
    )
    (concepts_dir / "sleep.md").write_text(
        "---\ntitle: Sleep Hygiene\ntype: concept\n---\n# Sleep Hygiene"
    )

    protocols_dir = wiki_dir / "protocols"
    protocols_dir.mkdir()
    (protocols_dir / "cold-exposure.md").write_text(
        "---\ntitle: Cold Exposure Protocol\ntype: protocol\n---\n# Cold Exposure"
    )

    config = _make_config()
    rebuild_index(wiki_dir, config, "2024-01-01T00:00:00Z", source_count=5)

    index_path = wiki_dir / "_index.md"
    assert index_path.exists()
    index_text = index_path.read_text()

    assert "# Test-Kb Knowledge Base Index" in index_text
    assert "Articles: 3 | Sources: 5" in index_text
    assert "[[concepts/fasting|Intermittent Fasting]]" in index_text
    assert "[[concepts/sleep|Sleep Hygiene]]" in index_text
    assert "[[protocols/cold-exposure|Cold Exposure Protocol]]" in index_text


def test_rebuild_index_empty_wiki(tmp_path):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    config = _make_config()
    rebuild_index(wiki_dir, config, "2024-01-01T00:00:00Z")

    index_path = wiki_dir / "_index.md"
    assert index_path.exists()
    assert "Articles: 0" in index_path.read_text()


def test_rebuild_index_counts_sources_from_raw(tmp_path):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "a.md").write_text("source A")
    (raw_dir / "b.pdf").write_bytes(b"%PDF")

    config = _make_config()
    # source_count not passed => should count from raw/
    rebuild_index(wiki_dir, config, "2024-01-01T00:00:00Z")

    index_text = (wiki_dir / "_index.md").read_text()
    assert "Sources: 2" in index_text


# ---------- append_log ----------


def test_append_log_creates_file(tmp_path):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()

    append_log(wiki_dir, "compile", "Did some work")

    log_path = wiki_dir / "_log.md"
    assert log_path.exists()
    text = log_path.read_text()
    assert "# Operation Log" in text
    assert "compile | Did some work" in text


def test_append_log_appends_to_existing(tmp_path):
    wiki_dir = tmp_path / "wiki"
    wiki_dir.mkdir()

    append_log(wiki_dir, "first", "Message 1")
    append_log(wiki_dir, "second", "Message 2")

    text = (wiki_dir / "_log.md").read_text()
    assert "first | Message 1" in text
    assert "second | Message 2" in text
    # Only one header
    assert text.count("# Operation Log") == 1

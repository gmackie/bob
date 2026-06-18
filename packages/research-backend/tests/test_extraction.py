"""Tests for the note extraction endpoint."""

from research_backend.routes.extraction import _parse_entities


def test_parse_entities_valid_json():
    raw = '[{"name": "CRISPR-Cas9", "type": "method", "salience": 0.9}]'
    result = _parse_entities(raw)
    assert len(result) == 1
    assert result[0]["name"] == "CRISPR-Cas9"
    assert result[0]["type"] == "method"
    assert result[0]["salience"] == 0.9


def test_parse_entities_with_markdown_fencing():
    raw = '```json\n[{"name": "GPT-4", "type": "tool", "salience": 0.8}]\n```'
    result = _parse_entities(raw)
    assert len(result) == 1
    assert result[0]["name"] == "GPT-4"


def test_parse_entities_invalid_type_falls_back_to_concept():
    raw = '[{"name": "foo", "type": "unknown_type", "salience": 0.5}]'
    result = _parse_entities(raw)
    assert len(result) == 1
    assert result[0]["type"] == "concept"


def test_parse_entities_empty_array():
    assert _parse_entities("[]") == []


def test_parse_entities_invalid_json():
    assert _parse_entities("not json at all") == []


def test_parse_entities_max_20():
    raw = "[" + ",".join(
        f'{{"name": "e{i}", "type": "concept", "salience": 0.5}}'
        for i in range(30)
    ) + "]"
    result = _parse_entities(raw)
    assert len(result) == 20


def test_parse_entities_salience_clamped():
    raw = '[{"name": "x", "type": "concept", "salience": 5.0}]'
    result = _parse_entities(raw)
    assert result[0]["salience"] == 1.0


def test_parse_entities_missing_name_skipped():
    raw = '[{"type": "concept", "salience": 0.5}]'
    result = _parse_entities(raw)
    assert len(result) == 0


def test_parse_entities_missing_type_skipped():
    raw = '[{"name": "foo", "salience": 0.5}]'
    result = _parse_entities(raw)
    assert len(result) == 0


def test_parse_entities_non_list_returns_empty():
    raw = '{"name": "foo", "type": "concept"}'
    result = _parse_entities(raw)
    assert result == []


def test_parse_entities_negative_salience_clamped():
    raw = '[{"name": "x", "type": "concept", "salience": -2.0}]'
    result = _parse_entities(raw)
    assert result[0]["salience"] == 0.0


def test_parse_entities_non_numeric_salience_defaults():
    raw = '[{"name": "x", "type": "concept", "salience": "high"}]'
    result = _parse_entities(raw)
    assert result[0]["salience"] == 0.5


def test_parse_entities_non_dict_items_skipped():
    raw = '["not a dict", {"name": "x", "type": "concept", "salience": 0.5}]'
    result = _parse_entities(raw)
    assert len(result) == 1
    assert result[0]["name"] == "x"

"""Shared Python producer / TypeScript consumer contract fixture."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from research_backend.dive.results import DiveStoredResult, persisted_result

FIXTURE = Path(__file__).parents[2] / "ooda/src/contracts/v1/__fixtures__/dive-result-v1.json"


def test_shared_result_fixture_matches_writer_and_reader():
    value = json.loads(FIXTURE.read_text())
    assert DiveStoredResult.model_validate(value).model_dump(mode="json") == value
    written = persisted_result(value, value["errors"])
    assert written["cluster_summary"] == value["cluster_summary"]
    assert written["errors"] == value["errors"]
    assert written["visited_source_ids"] == value["visited_source_ids"]
    assert written["finished_at"]


def test_result_version_and_cluster_shape_are_validated():
    value = json.loads(FIXTURE.read_text())
    with pytest.raises(ValidationError):
        DiveStoredResult.model_validate({**value, "version": "unknown"})
    with pytest.raises(ValidationError):
        DiveStoredResult.model_validate({**value, "cluster_summary": {"clusters": [{"size": -1}]}})

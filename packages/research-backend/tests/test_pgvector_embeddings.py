from __future__ import annotations

import numpy as np
import pytest

from research_backend.embeddings import (
    SOURCE_EMBEDDING_DIMENSIONS,
    vector_literal,
)


def test_vector_literal_accepts_exact_finite_source_embedding() -> None:
    value = vector_literal(np.full(SOURCE_EMBEDDING_DIMENSIONS, 0.25, dtype=np.float32))
    assert value.startswith("[0.25,0.25")
    assert value.endswith("]")


def test_vector_literal_rejects_wrong_dimensions_and_non_finite_values() -> None:
    with pytest.raises(ValueError, match="expected 768"):
        vector_literal(np.zeros(SOURCE_EMBEDDING_DIMENSIONS - 1, dtype=np.float32))

    invalid = np.zeros(SOURCE_EMBEDDING_DIMENSIONS, dtype=np.float32)
    invalid[0] = np.nan
    with pytest.raises(ValueError, match="non-finite"):
        vector_literal(invalid)

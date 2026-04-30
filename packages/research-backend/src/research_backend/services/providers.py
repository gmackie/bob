from collections.abc import Iterable
from typing import Protocol

from pydantic import BaseModel


class ProviderWarning(BaseModel):
    provider: str
    message: str


class ProviderSearchResult(Protocol):
    def search(self, query: str, *, page: int) -> Iterable[dict]:
        ...

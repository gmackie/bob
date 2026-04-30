"""Database engine and session management for research-backend.

SQLModel tables (Paper, Collection, UsageEvent, etc.) live in the default
``public`` schema and are created by ``init_db`` via
``SQLModel.metadata.create_all``.

The Drizzle-managed tables (sources, embeddings, topics, etc.) live in the
``research_vault`` schema and are **not** touched here — they are governed
exclusively by OODA's Drizzle migrations.
"""

from collections.abc import Iterator

from fastapi import Request
from sqlmodel import Session, SQLModel, create_engine

from research_backend.config import Settings

# Ensure all SQLModel table classes are imported so metadata.create_all
# picks them up.  The db_models package re-exports every table class.
import research_backend.db_models as _models  # noqa: F401


def build_engine(settings: Settings):
    """Create a SQLAlchemy/SQLModel engine from *settings.database_url*."""
    return create_engine(settings.database_url, echo=False)


def init_db(engine) -> None:
    """Create all SQLModel-managed tables (public schema only).

    This deliberately does NOT touch the ``research_vault`` schema, which is
    owned by Drizzle migrations.
    """
    SQLModel.metadata.create_all(engine)


def get_session(request: Request) -> Iterator[Session]:
    """FastAPI dependency that yields a SQLModel Session."""
    with Session(request.app.state.engine) as session:
        yield session

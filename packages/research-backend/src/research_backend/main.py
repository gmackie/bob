import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from research_backend.config import Settings
from research_backend.db import build_engine, init_db
from research_backend.dive.scheduler import DiveScheduler
from research_backend.health import router as health_router
from research_backend.routes.chats import router as chats_router
from research_backend.routes.core import router as core_router
from research_backend.routes.dives import router as dives_router
from research_backend.routes.embeddings import router as embeddings_router
from research_backend.routes.extraction import router as extraction_router
from research_backend.routes.kb import router as kb_router
from research_backend.routes.search import router as search_router
from research_backend.routes.youtube import router as youtube_router


def create_app(overrides: dict[str, str] | None = None) -> FastAPI:
    settings = Settings.from_overrides(overrides)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = build_engine(settings)
        init_db(engine)
        app.state.settings = settings
        app.state.engine = engine

        scheduler_enabled = (
            os.getenv("DIVE_SCHEDULER_ENABLED", "true").lower() == "true"
        )
        dive_scheduler = DiveScheduler(
            session_factory=lambda: Session(engine),
            enabled=scheduler_enabled,
        )
        dive_scheduler.start()
        app.state.dive_scheduler = dive_scheduler

        try:
            yield
        finally:
            dive_scheduler.shutdown()
            engine.dispose()

    app = FastAPI(title="OODA Research Backend", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[os.getenv("OODA_CORS_ORIGIN", "http://localhost:3000")],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Health check (standalone, no db required)
    app.include_router(health_router)

    # Research API routes
    app.include_router(core_router)
    app.include_router(chats_router)
    app.include_router(dives_router)
    app.include_router(embeddings_router)
    app.include_router(kb_router)
    app.include_router(search_router)
    app.include_router(extraction_router)
    app.include_router(youtube_router)

    return app


app = create_app()

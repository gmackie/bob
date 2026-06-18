# @ooda/research-backend

Python FastAPI sidecar for research operations. This is NOT a pnpm/turbo workspace package — it's a standalone Python project that lives in the monorepo for co-location.

## Development

```bash
cd packages/research-backend
uv sync --dev          # Install dependencies
uv run pytest          # Run tests
uv run ruff check .    # Lint
uv run uvicorn research_backend.main:app --reload --port 8000  # Start dev server
```

Or from the repo root:

```bash
pnpm dev:research      # Start the research backend in dev mode
```

## Docker

```bash
docker build -t ooda-research-backend .
docker run -p 8000:8000 ooda-research-backend
```

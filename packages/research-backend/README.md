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

All routes except the content-free `GET /health` liveness probe require
`Authorization: Bearer $RESEARCH_SERVICE_TOKEN`. The API fails closed with
`503` when the token is not configured. Set the same high-entropy value on the
OODA server and this sidecar; clients must never call the sidecar directly.

Or from the repo root:

```bash
pnpm dev:research      # Start the research backend in dev mode
```

## Docker

```bash
docker build -t ooda-research-backend .
docker run -p 8000:8000 ooda-research-backend
```

## Production service

The checked-in `ooda-research-backend.service` runs a release-local virtualenv
as the unprivileged `bob` user, binds only `127.0.0.1:8000`, and reads secrets
from `/etc/ooda/research-backend.env`. Install each release under
`/opt/ooda-research-backend/releases/<git-sha>`, point the `current` symlink at
the verified release, then restart the service. The unit intentionally blocks
home-directory access so the sidecar cannot inherit Claude, Codex, Grok, or
other operator credentials; subscription-backed agent work belongs to the
separately contained OODA runner.

FROM python:3.12-slim

WORKDIR /app

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files first for layer caching
COPY pyproject.toml uv.lock* ./

# Install production deps only
RUN uv sync --no-dev --frozen 2>/dev/null || uv sync --no-dev

# Copy source
COPY src/ ./src/

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "research_backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

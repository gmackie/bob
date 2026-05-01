#!/usr/bin/env bash
set -euo pipefail
SIDECAR_URL="${RESEARCH_API_URL:-http://localhost:8000}"
mkdir -p dist/openapi
curl -sf "$SIDECAR_URL/openapi.json" > dist/openapi/research-sidecar.json
echo "Wrote research sidecar spec → dist/openapi/research-sidecar.json"

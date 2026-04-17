#!/usr/bin/env bash
# Generate Uzbek descriptions for celebrities with empty description_uz using LM Studio.
#
# Usage:
#   ./scripts/generate-descriptions.sh
#   ./scripts/generate-descriptions.sh --limit 20
#   ./scripts/generate-descriptions.sh --force   # regenerate all
set -euo pipefail

LM_BASE_URL="${LM_BASE_URL:-http://192.168.100.3:1234/v1}"
LM_API_KEY="${LM_API_KEY:-lmstudio}"
LM_MODEL="${LM_MODEL:-gemma-4-26b-a4b-it}"

docker compose exec -T \
  -e "LM_BASE_URL=${LM_BASE_URL}" \
  -e "LM_API_KEY=${LM_API_KEY}" \
  -e "LM_MODEL=${LM_MODEL}" \
  -e "DATABASE_URL=postgresql://${POSTGRES_USER:-starface}:${POSTGRES_PASSWORD:-starface}@postgres:5432/${POSTGRES_DB:-starface}" \
  ml python -m app.generate_descriptions "$@"

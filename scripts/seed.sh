#!/usr/bin/env bash
# Fetch celebrity portraits from Wikidata/Commons, enroll them into the DB,
# and generate UZ/RU/EN descriptions grounded in Wikipedia via LM Studio.
#
# Usage:
#   ./scripts/seed.sh                                 # all categories, defaults
#   ./scripts/seed.sh --category world --limit 500
#   ./scripts/seed.sh --category uz
set -euo pipefail

ARGS=("$@")

OUT_DIR="/data/seeds/wikidata"
DB_URL="postgresql://${POSTGRES_USER:-starface}:${POSTGRES_PASSWORD:-starface}@postgres:5432/${POSTGRES_DB:-starface}"
LM_BASE_URL="${LM_BASE_URL:-http://192.168.100.3:1234/v1}"
LM_API_KEY="${LM_API_KEY:-lmstudio}"
LM_MODEL="${LM_MODEL:-gemma-4-26b-a4b-it}"

phase() {
  local title="$1"
  echo
  echo "┌──────────────────────────────────────────────────────────────"
  printf "│ %s\n" "$title"
  echo "└──────────────────────────────────────────────────────────────"
}

start=$(date +%s)

phase "1/3  Wikidata → download photos + metadata"
docker compose exec -T ml python -u -m app.fetch_wikidata --out-dir "${OUT_DIR}" "${ARGS[@]}"

before_count=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-starface}" -d "${POSTGRES_DB:-starface}" -At -c "SELECT count(*) FROM celebrities;")

phase "2/3  enroll → face detection + insert into Postgres"
docker compose exec -T ml python -u -m app.enroll \
  --manifest "${OUT_DIR}/celebrities.csv" \
  --database-url "${DB_URL}" \
  --data-dir /data

after_enroll=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-starface}" -d "${POSTGRES_DB:-starface}" -At -c "SELECT count(*) FROM celebrities;")

phase "3/3  LM Studio → UZ/RU/EN descriptions from Wikipedia"
docker compose exec -T \
  -e "LM_BASE_URL=${LM_BASE_URL}" \
  -e "LM_API_KEY=${LM_API_KEY}" \
  -e "LM_MODEL=${LM_MODEL}" \
  -e "DATABASE_URL=${DB_URL}" \
  ml python -u -m app.generate_descriptions

after_gen=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-starface}" -d "${POSTGRES_DB:-starface}" -At -c "SELECT count(*) FROM celebrities WHERE description_uz IS NOT NULL AND description_uz != '';")

end=$(date +%s)
elapsed=$((end - start))
mins=$((elapsed / 60))
secs=$((elapsed % 60))

echo
echo "═══════════════════════════════════════════════════════════════"
printf "✓ seed finished in %dm %ds\n" "$mins" "$secs"
printf "  celebrities: %d → %d (+%d)\n" "$before_count" "$after_enroll" "$((after_enroll - before_count))"
printf "  with UZ description: %d / %d\n" "$after_gen" "$after_enroll"
echo "═══════════════════════════════════════════════════════════════"

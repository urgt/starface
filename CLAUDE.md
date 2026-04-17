# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

StarFace UZ is a B2B SaaS white-label kiosk platform: a visitor flashes ✌️ at a camera, and gets a celebrity look-alike result with a brand-customized QR code. The system is two cooperating services plus Postgres/Redis, glued via `docker-compose.yml`.

- `apps/web` — Next.js 15 App Router (kiosk, mobile result page `/r/[resultId]`, admin, brand analytics `/b/[brandId]/analytics`, all `/api/*` routes). Drizzle ORM → Postgres. Package name `@starface/web` in pnpm workspace.
- `apps/ml` — FastAPI + InsightFace (`buffalo_l` / ArcFace r50, 512-d embeddings). Hosts `/ml/embed`, the import pipeline at `/ml/import` (SSE), and a description-generation job queue at `/ml/describe/*`.
- Postgres 16 + pgvector (HNSW index on `celebrity_photos.embedding`); Redis (present in compose, used by web).
- Storage is the host `./data` directory, bind-mounted into both `web` and `ml` containers at `/data`. User photos live in `data/users/` (TTL 24h), celebrity photos in `data/celebrities/`, Wikidata seed cache in `data/seeds/wikidata/`.

## Common commands

All day-to-day development runs through docker compose. Service names: `postgres`, `redis`, `migrate`, `ml`, `web`.

```bash
docker compose up --build               # full stack; first build ~3–5 min
docker compose logs -f web ml           # tail app logs
docker compose exec web sh              # shell into web container
docker compose exec postgres psql -U starface -d starface
```

### Web (from `apps/web`, or via workspace filter at repo root)

```bash
pnpm --filter @starface/web dev         # next dev on :3000 (use inside container or native)
pnpm --filter @starface/web build
pnpm --filter @starface/web lint        # next lint
pnpm --filter @starface/web typecheck   # tsc --noEmit — always run after web changes
pnpm --filter @starface/web db:generate # drizzle-kit generate (from schema.ts)
pnpm --filter @starface/web db:push     # push schema to DB (dev only)
```

There is no test suite configured. The only correctness gates are `typecheck` and `lint`.

### ML (from `apps/ml`)

```bash
uvicorn app.main:app --reload --port 8000
python -m app.enroll --manifest ./seeds/celebrities.csv --database-url $DATABASE_URL
python -m app.fetch_wikidata --out-dir /data/seeds/wikidata --category uz
python -m app.generate_descriptions          # requires DATABASE_URL + LM_* env
```

### Database migrations

Schema lives in two places and must stay in sync:
- `apps/web/drizzle/schema.ts` — Drizzle TS schema (authoritative for the web codebase types).
- `docker/migrate-and-seed.sql` — idempotent SQL run by the `migrate` compose service on every `up`. Seeds the `demo` brand and `app_settings` defaults. **Edit this file directly for schema changes destined for docker-compose startup** — it is written to tolerate existing state (`IF NOT EXISTS`, backfill blocks, conditional `ALTER TABLE`).

`drizzle-kit generate` produces migrations under `apps/web/drizzle/migrations/` but the compose pipeline does not apply them — the SQL in `docker/migrate-and-seed.sql` is what actually runs at startup.

### Seeding celebrities

```bash
./scripts/seed.sh                          # all categories (~15–30 min, needs ml+postgres up)
./scripts/seed.sh --category uz|cis|world
```

Three-phase pipeline (also exposed via `POST /ml/import` as SSE):
1. `fetch_wikidata.py` — SPARQL + Wikimedia Commons photos → `data/seeds/wikidata/`.
2. `enroll.py` — face detect/embed + INSERT into `celebrities` + `celebrity_photos`. Idempotent by `name`.
3. `generate_descriptions.py` — UZ/RU/EN descriptions via LM Studio (config in `app_settings`, see below).

## Architecture notes

### Match flow (`POST /api/match`)

1. Validate brand is active (`brands` table).
2. Call `ML_SERVICE_URL/ml/embed` (15s timeout, single-face) → 512-d vector.
3. Top-1 nearest neighbor over `celebrity_photos` via pgvector `<=>` (cosine distance) filtered by `celebrities.active`.
4. `mapCosineToPct` (in `apps/web/lib/config.ts`) rescales cosine → display percent using `MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`. The UX guarantees a "pleasant" floor (never shows below 60%) — tune via env vars, not by changing formula.
5. Save user photo to `data/users/`, insert `match_results` with `expiresAt = now + USER_PHOTO_TTL_HOURS`, emit `match_completed` event.
6. User embeddings are **never** persisted. Only the match result + photo (for 24h).

### Data retention

`POST /api/admin/cleanup` deletes expired `match_results` and associated files. Wire this to a cron externally — there is no built-in scheduler.

### Auth

Basic auth via `middleware.ts` guards `/admin/*` and `/api/admin/*` using `ADMIN_USER` / `ADMIN_PASSWORD` env vars. Brand analytics at `/b/[brandId]/analytics?t=<token>` is unauth'd but gated by `brands.analytics_token`. Do not add other auth schemes without checking the middleware matcher.

### LLM / descriptions

LLM config (base URL, API key, model) is stored in the `app_settings` table and editable from `/admin/settings`. `apps/web/lib/settings.ts` (`getLlmConfig`) is the single read path for the web side; `apps/ml/app/generate_descriptions.py` reads the same keys. Env vars `LM_BASE_URL` / `LM_API_KEY` / `LM_MODEL` are defaults only — DB values win. Default points at LM Studio on localhost; the seed script's default `LM_BASE_URL` is a LAN IP (`192.168.100.3:1234`) — override explicitly.

### Description job queue

`apps/ml/app/job_queue.py` is an in-process async queue (default 2 workers via `DESC_WORKERS`). Events stream to the web UI via `GET /ml/describe/events` (SSE). The queue is process-local — it does not survive `ml` container restarts; `POST /ml/describe/enqueue` with `only_empty=true` is how to resume.

### ML service contract

Errors from `/ml/embed` come back as HTTP 422 with `{detail: {code, message}}` where `code ∈ {no_face, multiple_faces, low_quality, internal}`. The web `ml-client.ts` decodes these into `MlError` — preserve this contract end-to-end so the kiosk UI can show proper retry hints.

### Workspace & paths

- pnpm workspace includes only `apps/web` (`pnpm-workspace.yaml`). The ML service is pure Python and is not part of the pnpm graph.
- TS path alias: `@/*` → `apps/web/*` (see `tsconfig.json`). Do not import across workspace boundaries (there aren't any).
- Next.js is on React 19 RC and Next 15 App Router — keep route files server-rendered unless `"use client"` is required.

### Storage access

Never construct filesystem paths from user input directly. Use `apps/web/lib/storage.ts` (`saveUserPhoto`, `saveCelebrityPhoto`, `readStoredFile`) — it applies `DATA_DIR` + path-traversal scrubbing. Files are served through `/api/files/[...path]` (also goes through that sanitization).

## Config reference

See `.env.example`. Match-tuning knobs (`MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`, `USER_PHOTO_TTL_HOURS`) are read at request time in `lib/config.ts` — no rebuild needed to change them, but the web container must be restarted to pick up new env vars.

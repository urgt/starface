# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

StarFace UZ is a B2B SaaS white-label kiosk platform: a visitor flashes ✌️ at a camera, and gets a celebrity look-alike result with a brand-customized QR code. The stack is Cloudflare-only — there is no server-side ML service and no Docker.

- `apps/web` — Next.js 15 App Router deployed to Cloudflare Pages via `@opennextjs/cloudflare`. Hosts the kiosk, mobile result page `/r/[resultId]`, admin, brand analytics `/b/[brandId]/analytics`, and all `/api/*` routes. Drizzle ORM → D1 (SQLite). Package name `@starface/web`.
- `scripts/` — local-only seed/enroll tooling (`@starface/scripts`, tsx). Runs on the operator's machine; calls prod's `POST /api/admin/enroll` with Basic Auth and `PATCH /api/admin/celebrities/:id` for descriptions. Contains `scripts/server/` — a tiny localhost UI (`dev:ui`) wrapping the seed scripts.

Cloudflare bindings (see `apps/web/wrangler.toml`):
- **D1** — `DB` → `starface` (metadata: brands, celebrities, celebrity_photos, match_results, events, app_settings).
- **Vectorize** — `FACES` → `starface-faces` (512-D cosine index of celebrity face embeddings + metadata).
- **R2** — `STORAGE` → `starface-storage` (user photos under `users/{uuid}.jpg` TTL 24h, celebrity photos, brand logos, and the kiosk's `models/mobilefacenet.onnx`).
- **Cron trigger** — `0 */6 * * *` dispatches cleanup.

## Common commands

### Web (from repo root via workspace filter or from `apps/web/`)

```bash
pnpm --filter @starface/web dev              # next dev on :3000
pnpm --filter @starface/web build            # next build
pnpm --filter @starface/web lint             # next lint
pnpm --filter @starface/web typecheck        # tsc --noEmit — always run after web changes
pnpm --filter @starface/web preview          # opennextjs-cloudflare build && preview (local Workers runtime)
pnpm --filter @starface/web deploy           # opennextjs-cloudflare build && deploy (prod)
pnpm --filter @starface/web cf-typegen       # regenerate cloudflare-env.d.ts from wrangler.toml

pnpm --filter @starface/web db:generate      # drizzle-kit generate (from schema.ts)
pnpm --filter @starface/web db:migrate:local # wrangler d1 migrations apply --local
pnpm --filter @starface/web db:migrate:remote# wrangler d1 migrations apply --remote
pnpm --filter @starface/web db:push          # drizzle-kit push (rarely — prefer migrations)
```

Root shortcuts: `pnpm dev:web`, `pnpm dev:ui`, `pnpm build:web`, `pnpm db:generate|db:migrate|db:push`.

There is no test suite. The correctness gates are `typecheck` and `lint`.

### Seeding (from `scripts/`, or via workspace filter)

Fully local pipeline — see `scripts/README.md` for the details. ONNX models (`mobilefacenet.onnx`, `yunet.onnx`) must live in `scripts/models/`; the kiosk loads the same `mobilefacenet.onnx` from R2 (`models/mobilefacenet.onnx`).

```bash
pnpm --filter @starface/scripts fetch-wikidata --category uz --limit 50
pnpm --filter @starface/scripts enroll --category uz --dry-run
pnpm --filter @starface/scripts enroll --category uz
pnpm --filter @starface/scripts descriptions --limit 20
pnpm --filter @starface/scripts dev:ui       # localhost UI for the scripts above
pnpm --filter @starface/scripts typecheck
```

Seed config lives in `scripts/.env.example` (`PROD_URL`, `ADMIN_PASSWORD`, `LM_*`, `FACENET_MODEL_PATH`, `YUNET_MODEL_PATH`). The `.seed-progress.json` file in cwd makes runs resumable.

### Database migrations

Schema is authoritative in `apps/web/drizzle/schema.ts`. The init migration `apps/web/drizzle/migrations/0000_init.sql` is applied by `wrangler d1 migrations apply` against the D1 binding. After schema changes:

```bash
pnpm --filter @starface/web db:generate
pnpm --filter @starface/web db:migrate:local    # try it locally first
pnpm --filter @starface/web db:migrate:remote
```

## Architecture notes

### Match flow (`POST /api/match`)

1. Kiosk detects a face with MediaPipe `FaceDetector` (Blaze Face, WASM + tflite model from Google CDN) and embeds it with MobileFaceNet via `onnxruntime-web`. Model `mobilefacenet.onnx` is fetched through `/api/files/models/mobilefacenet.onnx` (R2-backed). All of this runs **in the browser** — see `apps/web/lib/face-embed.ts`.
2. Client POSTs `{brandId, embedding (512 floats), userPhotoBase64, detScore, faceQuality, clientSex?, clientAge?}` to `/api/match`.
3. Route validates the brand is active, then queries `env.FACES.query(embedding, topK)` (Vectorize) with metadata return.
4. Re-rank (`lib/config.ts` knobs): gender mismatch penalty (`MATCH_GENDER_PENALTY`, only applied when `faceQuality === "high"`), age penalty (`MATCH_AGE_PENALTY`), tiebreak delta (`MATCH_TIEBREAK_DELTA`). `MATCH_RERANK_K` bounds how many top vectors get re-ranked.
5. `mapCosineToPct` (`apps/web/lib/config.ts`) rescales cosine → display percent using `MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`. The UX guarantees a "pleasant" floor (never shows below 60%) — tune via env vars / wrangler `[vars]`, not by changing the formula.
6. User photo saved to R2 `users/{uuid}.jpg`; match row inserted into D1 `match_results` with `expiresAt = now + USER_PHOTO_TTL_HOURS`; event row appended to `events`.
7. User embeddings are **never** persisted. Only the match result + user photo (for `USER_PHOTO_TTL_HOURS`).

### Data retention

`POST /api/cron/cleanup` (Bearer auth with `CRON_SHARED_SECRET`) deletes expired `match_results` and their R2 objects. It's invoked every 6 hours by the Cloudflare Cron Trigger defined in `wrangler.toml` (`crons = ["0 */6 * * *"]`). There is no manual admin cleanup route anymore.

### Auth

Basic auth in `apps/web/middleware.ts` guards `/admin/*` and `/api/admin/*` using `ADMIN_USER` / `ADMIN_PASSWORD`. The middleware intentionally suppresses the `WWW-Authenticate` header on Next.js prefetch requests (`next-router-prefetch`, `purpose: prefetch`, `sec-purpose: prefetch`) so background prefetches to `/admin` don't pop a browser Basic Auth dialog. Don't regress that behavior.

Brand analytics at `/b/[brandId]/analytics?t=<token>` is unauth'd but gated by `brands.analytics_token` (HMAC'd against `BRAND_ANALYTICS_TOKEN_SALT`). Don't add other auth schemes without checking the middleware matcher.

### Seeding / enrollment

There is no in-app import pipeline. All enrollment happens locally:
- `scripts/seed/wikidata-cli.ts` — SPARQL Wikidata + Wikimedia Commons → local photo cache + `manifest.json`.
- `scripts/seed/enroll.ts` — local YuNet detect + MobileFaceNet embed (`onnxruntime-node`, same model as kiosk), batched `POST /api/admin/enroll` with Basic Auth. Idempotent via the progress file.
- `scripts/seed/descriptions.ts` — Wikipedia intro + local OpenAI-compatible LLM (Ollama / LM Studio) → `PATCH /api/admin/celebrities/:id` (updates UZ/RU/EN description in D1).

The prod worker never calls any LLM. If you touch `apps/web/lib/face-embed.ts`, update `scripts/seed/enroll.ts` in lockstep — the two must produce vectors in the same space (same model file, same 112×112 preprocessing, same L2 normalization). Re-enroll everything if the model changes.

### Storage access

All file IO goes through R2 via `apps/web/lib/storage.ts` (`saveUserPhoto`, `saveCelebrityPhoto`, `readStoredFile`, `deleteStoredFile`). Keys are scrubbed (`safeKey` strips leading slashes and `..`). Files are served through `/api/files/[...path]` which applies the same sanitization. Never construct R2 keys from user input directly.

### Workspace & paths

- `pnpm-workspace.yaml` includes `apps/web` and `scripts`.
- TS path alias: `@/*` → `apps/web/*` (see `apps/web/tsconfig.json`). Do not import across workspace boundaries — `scripts/` must not depend on `apps/web/*`; it talks to prod only via HTTP.
- React 19 RC + Next 15 App Router — keep route files server-rendered unless `"use client"` is required. Client ML code (`lib/face-embed.ts`) is explicitly client-only.

## Config reference

Two config surfaces:

1. **Prod (`apps/web/wrangler.toml` `[vars]` + `wrangler secret put`)** — `MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`, `USER_PHOTO_TTL_HOURS`, `NEXT_PUBLIC_APP_URL`, `GEMINI_MODEL` as vars; `ADMIN_USER`, `ADMIN_PASSWORD`, `CRON_SHARED_SECRET`, `BRAND_ANALYTICS_TOKEN_SALT`, `GEMINI_API_KEY` as secrets. Match-tuning knobs are read at request time in `lib/config.ts` — no rebuild needed to change them, but a redeploy is needed to pick up new `[vars]`.
2. **Local seed scripts (`scripts/.env.example` / `scripts/.env.local`)** — `PROD_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`, `LM_BASE_URL`, `LM_API_KEY`, `LM_MODEL`, `FACENET_MODEL_PATH`, `YUNET_MODEL_PATH`, `SEED_OUT_DIR`.

## Hard rules

- No server-side ML. Face detection and embedding happen in the browser (kiosk) or in a local Node process (`scripts/seed/enroll.ts`). There is no `ML_SERVICE_URL`, no FastAPI, no Docker. If a task asks for "server ML", that's an architectural change — flag it, don't silently reintroduce an external service.
- No Postgres / pgvector. D1 + Vectorize are the database. Schema changes go through `drizzle/schema.ts` → `drizzle-kit generate` → `wrangler d1 migrations apply`.
- No filesystem writes in the worker. Everything persistent is R2 (files), D1 (rows), or Vectorize (embeddings). `lib/storage.ts` is the only path to R2.

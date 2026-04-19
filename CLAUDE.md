# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

StarFace UZ is a B2B SaaS white-label kiosk platform: a visitor flashes ✌️ at a camera, and gets a celebrity look-alike result with a brand-customized QR code. Cloudflare Pages hosts the app + data; a single Modal.com GPU container hosts the embedding model.

- `apps/web` — Next.js 15 App Router deployed to Cloudflare Pages via `@opennextjs/cloudflare`. Hosts the kiosk, mobile result page `/r/[resultId]`, admin, brand analytics `/b/[brandId]/analytics`, and all `/api/*` routes. Drizzle ORM → D1 (SQLite). Package name `@starface/web`.
- `modal_app/` — Python pipeline (YuNet + DINOv2 ViT-L/14) deployed to Modal.com. Exposes `POST /embed` and `POST /embed/burst` behind a bearer-token secret. Called from the Cloudflare worker via `/api/embed` proxy.
- `scripts/` — local-only seed/enroll tooling. `scripts/seed/py/` (Python, GPU, reuses `modal_app/pipeline.py`) is the current enrollment path. `scripts/seed/wikidata-cli.ts` and `scripts/seed/descriptions.ts` (Node/tsx) still handle Wikidata fetch and LLM descriptions. Legacy `scripts/seed/enroll.ts` (MobileFaceNet) is retained only for reference.

Cloudflare bindings (see `apps/web/wrangler.toml`):
- **D1** — `DB` → `starface` (metadata: brands, celebrities, celebrity_photos, match_results, events, app_settings).
- **Vectorize** — `FACES_V2` → `starface-faces-v2` (1024-D cosine index of DINOv2 embeddings + metadata).
- **R2** — `STORAGE` → `starface-storage` (user photos under `users/{uuid}.jpg` TTL 24h, celebrity photos, brand logos).
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

### Seeding

The current enrollment path is `scripts/seed/py/` — Python, local GPU, reuses `modal_app/pipeline.py` verbatim so the kiosk and the DB share the same embedding space.

```bash
# 1. Fetch photos (still the Node script — pure HTTP/SPARQL, no ML)
pnpm --filter @starface/scripts fetch-wikidata --category uz --limit 50

# 2. Enroll (Python, local GPU)
cd scripts/seed/py
cp .env.example .env.local   # set ADMIN_PASSWORD, YUNET_MODEL_PATH
uv sync
uv run python enroll.py --category uz --limit 20 --dry-run
uv run python enroll.py --category uz

# 3. Descriptions (unchanged — still Node + local LLM)
pnpm --filter @starface/scripts descriptions --limit 20
```

`scripts/models/yunet.onnx` is reused by both `scripts/seed/py/` (via `YUNET_MODEL_PATH`) and the Modal image (which downloads its own copy at build time). The `.seed-progress.json` file in cwd makes runs resumable. The legacy `scripts/seed/enroll.ts` + `scripts/seed/face-embed.ts` (Node, MobileFaceNet) is retained only as reference — do not re-introduce it into new pipelines.

### Modal (embedding service)

```bash
cd modal_app
pip install -r requirements.txt
modal secret create starface-modal MODAL_SHARED_SECRET=<long-random>
modal deploy modal_main.py
# Then store the same secret + the app URL on the Cloudflare side:
cd ../apps/web
pnpm wrangler secret put MODAL_SHARED_SECRET
pnpm wrangler secret put MODAL_EMBED_URL
```

### Database migrations

Schema is authoritative in `apps/web/drizzle/schema.ts`. The init migration `apps/web/drizzle/migrations/0000_init.sql` is applied by `wrangler d1 migrations apply` against the D1 binding. After schema changes:

```bash
pnpm --filter @starface/web db:generate
pnpm --filter @starface/web db:migrate:local    # try it locally first
pnpm --filter @starface/web db:migrate:remote
```

## Architecture notes

### Match flow

1. Kiosk captures a burst (MediaPipe Blaze Face is only a UX gate — "no face" before the shutter). It POSTs the raw JPEG frames to `/api/embed/burst` on the Cloudflare worker.
2. `/api/embed(/burst)` (`apps/web/app/api/embed/**`) forwards the multipart body to Modal with `Authorization: Bearer $MODAL_SHARED_SECRET`. Modal runs YuNet → 5-point similarity transform → 224×224 crop → **DINOv2 ViT-L/14** → 1024-D L2-normalized vector, plus optional FairFace gender/age. Pipeline lives in `modal_app/pipeline.py`.
3. Kiosk POSTs `{brandId, embedding (1024 floats), userPhotoBase64, detScore, faceQuality, clientSex, clientAge}` to `/api/match`.
4. Route validates the brand, then queries `env.FACES_V2.query(embedding, topK)` (Vectorize) with metadata return, and loads `blurScore`/`frontalScore` for the candidate photos from D1.
5. Re-rank (`lib/config.ts` knobs): `score = MATCH_W_COS·cos − gender_penalty − age_penalty − quality_penalty(blur, frontal)`. Gender penalty only applies when `faceQuality === "high"` and user age ≥ 16. Tiebreak delta swaps top-1 if an opposite-sex top is within `MATCH_TIEBREAK_DELTA`. `MATCH_RERANK_K` bounds how many top vectors get re-ranked (hard-capped at 50 by Vectorize).
6. `mapCosineToPct` (`apps/web/lib/config.ts`) rescales cosine → display percent using `MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`. The UX guarantees a "pleasant" floor (never shows below 60%) — tune via env vars / wrangler `[vars]`, not by changing the formula.
7. User photo saved to R2 `users/{uuid}.jpg`; match row inserted into D1 `match_results` with `expiresAt = now + USER_PHOTO_TTL_HOURS`; event row appended to `events`.
8. User embeddings are **never** persisted. Only the match result + user photo (for `USER_PHOTO_TTL_HOURS`).

### Data retention

`POST /api/cron/cleanup` (Bearer auth with `CRON_SHARED_SECRET`) deletes expired `match_results` and their R2 objects. It's invoked every 6 hours by the Cloudflare Cron Trigger defined in `wrangler.toml` (`crons = ["0 */6 * * *"]`). There is no manual admin cleanup route anymore.

### Auth

Basic auth in `apps/web/middleware.ts` guards `/admin/*` and `/api/admin/*` using `ADMIN_USER` / `ADMIN_PASSWORD`. The middleware intentionally suppresses the `WWW-Authenticate` header on Next.js prefetch requests (`next-router-prefetch`, `purpose: prefetch`, `sec-purpose: prefetch`) so background prefetches to `/admin` don't pop a browser Basic Auth dialog. Don't regress that behavior.

Brand analytics at `/b/[brandId]/analytics?t=<token>` is unauth'd but gated by `brands.analytics_token` (HMAC'd against `BRAND_ANALYTICS_TOKEN_SALT`). Don't add other auth schemes without checking the middleware matcher.

### Seeding / enrollment

There is no in-app import pipeline. All enrollment happens from the operator's machine:
- `scripts/seed/wikidata-cli.ts` — SPARQL Wikidata + Wikimedia Commons → local photo cache + `manifest.json`.
- `scripts/seed/py/enroll.py` — local GPU, imports `modal_app/pipeline.py` directly so it produces byte-identical embeddings to what Modal will see at match time. Batched `POST /api/admin/enroll` with Basic Auth. Idempotent via `.seed-progress.json`.
- `scripts/seed/descriptions.ts` — Wikipedia intro + local OpenAI-compatible LLM (Ollama / LM Studio) → `PATCH /api/admin/celebrities/:id` (updates UZ/RU/EN description in D1).

If you touch `modal_app/pipeline.py`, everything that consumed the old embedding space must be re-enrolled — the kiosk calls Modal at request time, and `scripts/seed/py/enroll.py` uses the same pipeline, so both will match automatically after re-running enrollment.

### Storage access

All file IO goes through R2 via `apps/web/lib/storage.ts` (`saveUserPhoto`, `saveCelebrityPhoto`, `readStoredFile`, `deleteStoredFile`). Keys are scrubbed (`safeKey` strips leading slashes and `..`). Files are served through `/api/files/[...path]` which applies the same sanitization. Never construct R2 keys from user input directly.

### Workspace & paths

- `pnpm-workspace.yaml` includes `apps/web` and `scripts`.
- TS path alias: `@/*` → `apps/web/*` (see `apps/web/tsconfig.json`). Do not import across workspace boundaries — `scripts/` must not depend on `apps/web/*`; it talks to prod only via HTTP.
- React 19 RC + Next 15 App Router — keep route files server-rendered unless `"use client"` is required. `apps/web/lib/face-embed.ts` is client-only and now only calls `/api/embed(/burst)` — it does NOT run a model in the browser.
- `modal_app/pipeline.py` is framework-agnostic: no Modal decorators, no FastAPI. It's imported both by `modal_app/modal_main.py` and by `scripts/seed/py/enroll.py`. That's the invariant that guarantees kiosk ↔ enrollment embedding parity.

## Config reference

Three config surfaces:

1. **Prod Cloudflare (`apps/web/wrangler.toml` `[vars]` + `wrangler secret put`)** — `MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`, `USER_PHOTO_TTL_HOURS`, `NEXT_PUBLIC_APP_URL`, `GEMINI_MODEL`, `MATCH_W_COS`, `MATCH_QUALITY_PENALTY` as vars; `ADMIN_USER`, `ADMIN_PASSWORD`, `CRON_SHARED_SECRET`, `BRAND_ANALYTICS_TOKEN_SALT`, `GEMINI_API_KEY`, `MODAL_SHARED_SECRET`, `MODAL_EMBED_URL` as secrets. Match-tuning knobs are read at request time in `lib/config.ts` — no rebuild needed to change them, but a redeploy is needed to pick up new `[vars]`.
2. **Modal (`modal secret create starface-modal`)** — `MODAL_SHARED_SECRET`. Same value as the Cloudflare secret; the `/api/embed` proxy adds it as a bearer token when calling Modal.
3. **Local seed scripts** — `scripts/.env.example` (Node fetcher / descriptions) and `scripts/seed/py/.env.example` (Python enrollment: `PROD_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`, `YUNET_MODEL_PATH`, optional `DINOV2_MODEL`, `SEED_OUT_DIR`).

## Hard rules

- All ML runs on Modal.com (`modal_app/`). The Cloudflare worker never loads a model; it proxies selfies to `POST /embed` and queries Vectorize. Face detection/embedding does NOT run in the browser anymore — MediaPipe Blaze Face stays only as a lightweight UX gate. If a task asks to bring ML back into the worker or browser, flag it as an architectural change.
- Commercial licensing: only Apache-2.0 / MIT / BSD / CC-BY-commercial-OK models may ship. Current stack: YuNet (BSD), DINOv2 ViT-L/14 (Apache 2.0), MediaPipe Blaze Face (Apache 2.0). FairFace (CC-BY 4.0) slot is wired via `pipeline.predict_attrs` but currently a stub. InsightFace `buffalo_l`, FaceCLIP, CelebA/VGGFace2/WebFace* are non-commercial and must not be introduced without a negotiated license.
- Dataset sourcing: celebrity photos come from Wikidata + Wikimedia Commons only (CC-BY / CC-BY-SA). Academic face datasets are research-only; don't import them.
- No Postgres / pgvector. D1 + Vectorize are the database. Schema changes go through `drizzle/schema.ts` → `drizzle-kit generate` → `wrangler d1 migrations apply`.
- No filesystem writes in the worker. Everything persistent is R2 (files), D1 (rows), or Vectorize (embeddings). `lib/storage.ts` is the only path to R2.

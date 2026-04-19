# StarFace UZ

B2B SaaS white-label платформа для киоск-развлечения «на кого ты похож из знаменитостей». Клиент-бренд получает URL, посетитель показывает ✌️ — получает результат с брендированным QR-кодом.

## Архитектура

- **Prod web (Cloudflare Pages)** — Next.js 15 через `@opennextjs/cloudflare` + D1 + Vectorize (**1024-D cosine**, `starface-faces-v2`) + R2 + Cron Triggers. Worker никогда не загружает ML-модель — только проксирует и делает запросы к Vectorize.
- **Prod ML (Modal.com)** — один L4-GPU контейнер `starface-ml` держит warm пайплайн: YuNet (детект + 5 keypoints) → Umeyama 5-point align (224×224 с margin 1.6×) → DINOv2 ViT-L/14 (1024-D L2-normalized) + FairFace ViT (gender + age) + blur/frontal quality scores. Эндпоинты `/embed`, `/embed/burst`, `/healthz`. Lifecycle и лицензии — `modal_app/README.md`.
- **Kiosk (browser)** — только MediaPipe Blaze Face как UX-гейт «лицо не видно». Кадры уходят сырыми на `/api/embed/burst`, оттуда на Modal. Никакого ONNX в браузере.
- **Seed/enroll (локально, GPU)** — `scripts/seed/py/` на Python. Импортирует тот же `modal_app/pipeline.py`, что гарантирует identical embedding space с киоском. Wikidata fetch + LLM descriptions — Node (`scripts/seed/*.ts`).

Подробная карта архитектуры и hard rules — в `CLAUDE.md`. Локальный запуск без Modal (на своей GPU) — в `LOCAL_DEV.md`.

## Репозиторий

```
apps/web/        — Next.js 15 (kiosk, admin, /api/*). Drizzle → D1
modal_app/       — Python pipeline + Modal FastAPI endpoint
scripts/         — Node seed (fetch-wikidata, descriptions) + Python enroll + dev-UI
```

## Prod deploy

### Modal (однократно)

```bash
cd modal_app
pip install -r requirements.txt
modal token new                                      # первичная авторизация
modal secret create starface-modal MODAL_SHARED_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
modal deploy modal_main.py                           # запомнить URL
```

### Cloudflare (однократно)

```bash
cd apps/web
pnpm wrangler d1 create starface                     # id → wrangler.toml
pnpm wrangler vectorize create starface-faces-v2 --dimensions=1024 --metric=cosine
pnpm wrangler r2 bucket create starface-storage

pnpm wrangler secret put ADMIN_USER
pnpm wrangler secret put ADMIN_PASSWORD
pnpm wrangler secret put CRON_SHARED_SECRET
pnpm wrangler secret put BRAND_ANALYTICS_TOKEN_SALT
pnpm wrangler secret put GEMINI_API_KEY
pnpm wrangler secret put MODAL_SHARED_SECRET          # тот же, что у Modal
pnpm wrangler secret put MODAL_EMBED_URL              # https://<workspace>--starface-ml-inference-web.modal.run

pnpm --filter @starface/web db:migrate:remote
pnpm run deploy
```

CI (`.github/workflows/deploy.yml`) ловит typecheck / Python syntax / миграции на каждом push в `main`.

## Seed (на локальной GPU)

```bash
# 1. Fetch photos (Node)
cd scripts
pnpm install
cp .env.example .env.local                            # PROD_URL, ADMIN_PASSWORD, LM_*, YUNET_MODEL_PATH
mkdir -p models && curl -L -o models/yunet.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
pnpm fetch-wikidata --category uz --limit 50

# 2. Embed + POST to prod (Python)
cd seed/py
cp .env.example .env.local                            # PROD_URL, ADMIN_PASSWORD, YUNET_MODEL_PATH
uv sync                                               # первое раз ~5–10 мин, тянет torch + transformers
uv run python enroll.py --category uz --dry-run
uv run python enroll.py --category uz

# 3. Generate UZ/RU/EN descriptions via local LLM
cd ..
pnpm descriptions --limit 20
```

`scripts/README.md` — детали и опции. `--reset-progress` сбрасывает `scripts/seed/py/.seed-progress.json`.

## Приватность

Жест ✌️ = implicit consent. Фото пользователя хранится 24 ч в R2 `users/`, затем удаляется Cron Trigger'ом (`/api/cron/cleanup` каждые 6 часов). Embedding пользователя в БД **не сохраняется** — только top-N целебрити + ссылка на фото.

## Верификация

- `curl $PROD/api/health` → `{"db":{"ok":true}}`
- `curl $MODAL/healthz` → `{"ok":true,"embeddingDim":1024}`
- Админка: `$PROD/admin` (Basic Auth `ADMIN_USER` / `ADMIN_PASSWORD`)
- Аналитика бренда: `$PROD/b/<brandId>/analytics?t=<token>` (токен в `brands.analytics_token`)

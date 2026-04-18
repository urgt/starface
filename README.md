# StarFace UZ

B2B SaaS white-label платформа для киоск-развлечения «на кого ты похож из знаменитостей». Клиент-бренд получает URL, посетитель показывает ✌️ — получает результат с брендированным QR-кодом.

## Архитектура

- **Prod (Cloudflare free tier)** — Pages (`@opennextjs/cloudflare`) + D1 + Vectorize (512-D cosine) + R2 + Cron Triggers. Никаких серверных ML-сервисов. В киоске лицо детектится (MediaPipe) и эмбеддится (MobileFaceNet ONNX через `onnxruntime-web`) прямо в браузере — на бэкенд уходит готовый 512-D вектор.
- **Seed/enroll (локально, на машине оператора)** — `@starface/scripts`: качает фото с Wikidata, гоняет их через ту же MobileFaceNet ONNX + YuNet-детектор, батчами шлёт на `POST /api/admin/enroll` прода. Описания (UZ/RU/EN) генерируются локальным Ollama / LM Studio и `PATCH`атся в D1.

## Репозиторий

```
apps/web/        — Next.js 15 (kiosk, admin, /api/*). Drizzle → D1
scripts/         — локальные seed-инструменты (enroll, descriptions, fetch-wikidata) + dev-UI
```

## Prod deploy (Cloudflare)

```bash
# 1. bindings
wrangler d1 create starface            # id → apps/web/wrangler.toml
wrangler vectorize create faces --dimensions=512 --metric=cosine
wrangler r2 bucket create starface-storage

# 2. secrets
cd apps/web
wrangler secret put ADMIN_USER
wrangler secret put ADMIN_PASSWORD
wrangler secret put CRON_SHARED_SECRET
wrangler secret put BRAND_ANALYTICS_TOKEN_SALT

# 3. schema + model asset
pnpm --filter @starface/web db:migrate:remote
wrangler r2 object put starface-storage/models/mobilefacenet.onnx --file=./models/mobilefacenet.onnx

# 4. ship
pnpm --filter @starface/web deploy
```

## Seed (на локальной машине оператора)

```bash
cd scripts
pnpm install
cp .env.example .env.local   # PROD_URL, ADMIN_PASSWORD, LM_*
mkdir -p models && curl -L -o models/yunet.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
# и положить mobilefacenet.onnx рядом

pnpm fetch-wikidata --category uz --limit 50
pnpm enroll --category uz --dry-run
pnpm enroll --category uz
pnpm descriptions --limit 20
```

Подробнее — `scripts/README.md`.

## Приватность

Жест ✌️ = implicit consent. Фото пользователя хранится 24 ч в R2 `users/`, затем удаляется Cron Trigger'ом (`/api/cron/cleanup` каждые 6 часов). Embedding пользователя в БД **не сохраняется** — только top-N-ближайший celebrity + ссылка на фото.

## Верификация

- `curl $PROD/api/health` → `{"db":{"ok":true}}`
- Админка: `$PROD/admin` (Basic Auth `ADMIN_USER` / `ADMIN_PASSWORD`)
- Аналитика бренда: `$PROD/b/<brandId>/analytics?t=<token>` (токен в `brands.analytics_token`)

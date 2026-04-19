# Local dev

Локальный запуск с использованием **локальной NVIDIA GPU** вместо Modal.com, но с реальными прод-ресурсами Cloudflare (D1 / R2 / Vectorize). Полезно когда:

- Free-tier Cloudflare Workers упирается в CPU/duration лимиты на bulk-операциях (enroll, crud).
- Не хочется тратить Modal compute на экспериментирование.
- Нужно дебажить пайплайн локально, но при этом видеть реальный state прода.

## Архитектура локального окружения

```
┌──────────┐   JPEG burst     ┌────────────────────┐   multipart      ┌──────────────────────┐
│ browser  │─────────────────▶│ wrangler dev       │─────────────────▶│ local_server.py      │
│ kiosk    │   /api/embed     │ (workerd, :8787)   │   bearer auth    │ Starlette (:8000)    │
└──────────┘                  │                    │                  │ DINOv2 + FairFace    │
                              │ bindings:          │                  │ → RTX GPU (CUDA)     │
                              │  DB  → prod D1     │                  └──────────────────────┘
                              │  STORAGE → prod R2 │
                              │  FACES_V2 → prod   │
                              └────────────────────┘
```

Ключевые моменты:

- В `apps/web/wrangler.toml` у всех биндингов стоит `remote = true` — локальный workerd ходит в прод D1/R2/Vectorize. Никакого локального клона БД нет.
- Локальный `modal_app/local_server.py` — Starlette-обёртка над `modal_app/pipeline.py`, **1-в-1** повторяет интерфейс прод-Modal (`POST /embed`, `POST /embed/burst`, `GET /healthz`, Bearer auth). Эмбеддинги — byte-identical с продом.
- В `.dev.vars` `MODAL_EMBED_URL` и `MODAL_SHARED_SECRET` указывают на локальный сервер, не на Modal.

## Однократная настройка

### 1. Зависимости

```bash
# Node
pnpm install

# Python (seed + local embed server)
uv sync --project scripts/seed/py
```

Первый `uv sync` займёт 5-10 мин — тянет torch+cu128 + transformers (~3 GB).

### 2. YuNet model

```bash
mkdir -p scripts/models
curl -L -o scripts/models/yunet.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
```

### 3. `scripts/seed/py/.env.local`

```ini
PROD_URL=https://starface.uz
ADMIN_USER=admin
ADMIN_PASSWORD=<your-admin-password>
YUNET_MODEL_PATH=/home/<user>/Desktop/starface/scripts/models/yunet.onnx
SEED_OUT_DIR=/home/<user>/Desktop/starface/scripts/seeds/wikidata
```

Этот же файл автоматически читается `local_server.py` — он берёт оттуда `YUNET_MODEL_PATH`.

### 4. `apps/web/.dev.vars`

```ini
GEMINI_API_KEY=<your-gemini-key>
ADMIN_USER=admin
ADMIN_PASSWORD=<same as .env.local above>
MODAL_EMBED_URL=http://localhost:8000
MODAL_SHARED_SECRET=local-dev
```

`.dev.vars` в `.gitignore` — секреты не уезжают в репо.

### 5. Авторизация в Cloudflare

```bash
pnpm --filter @starface/web exec wrangler login
```

Нужно один раз — чтобы workerd мог ходить в remote D1/R2/Vectorize под твоим аккаунтом.

## Запуск

Нужны **три терминала**. Порядок: сначала embed-сервер, потом воркер, потом всё остальное.

### Терминал 1 — локальный ML-сервер

```bash
cd /home/<user>/Desktop/starface
MODAL_SHARED_SECRET=local-dev PYTHONPATH=. \
  uv run --project scripts/seed/py python modal_app/local_server.py
```

Ждёшь строчку:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

Первый старт ~10-30 сек (загрузка DINOv2 + FairFace на GPU). Дальше каждый запрос ~0.3-0.4 сек на RTX 5060 Ti.

Проверка что жив:

```bash
curl http://127.0.0.1:8000/healthz
# {"ok":true,"embeddingDim":1024}
```

### Терминал 2 — Cloudflare воркер

```bash
pnpm --filter @starface/web preview
```

Эта команда делает `opennextjs-cloudflare build && opennextjs-cloudflare preview`:
- билдит worker-бандл через OpenNext (~30 сек)
- поднимает workerd на `http://localhost:8787`
- подгружает `.dev.vars` как env
- бинды D1/R2/Vectorize идут в прод (благодаря `remote = true` в `wrangler.toml`)

Первый билд долгий, последующие — быстрее за счёт кеша.

### Терминал 3 — то что тестируем

**Киоск в браузере:**

```
http://localhost:8787
```

`/api/embed/burst` проксирует в `MODAL_EMBED_URL` → твой локальный сервер → GPU.

**Админка:**

```
http://localhost:8787/admin
```

Basic Auth значения из `.dev.vars`.

**Enroll от Node-манифеста:**

```bash
# 1. Фетчим фото с Wikidata (Node, без GPU)
pnpm --filter @starface/scripts fetch-wikidata --category uz --limit 50

# 2. Считаем эмбеддинги локально, POST'им в локальный воркер (а тот — в прод D1/R2/Vectorize)
PROD_URL=http://localhost:8787 \
  uv run --project scripts/seed/py python scripts/seed/py/enroll.py --category uz
```

Прогресс в `scripts/seed/py/.seed-progress.json`, идемпотентно. `--reset-progress` если надо перегнать.

## Что пишется локально vs в прод

| Действие | Куда уходит |
|---|---|
| ML-инференс (DINOv2, FairFace, YuNet) | **Локально** → твоя GPU |
| Чтение celebrities / photos / events | **Прод D1** |
| Вставка/апдейт celebrities + celebrity_photos | **Прод D1** |
| Сохранение файлов (users/, celebs/) | **Прод R2** |
| Upsert эмбеддингов + query top-K | **Прод Vectorize** |
| Cron cleanup | Не запускается локально (нет триггеров в dev) |

То есть **любые действия через локальный воркер видны проду немедленно**. Тестовые записи лучше потом удалять через админку.

## Проверки / диагностика

```bash
# Сервер жив и GPU видна
curl http://127.0.0.1:8000/healthz
# → {"ok":true,"embeddingDim":1024}

# Воркер жив и бьёт до локального Modal
curl http://localhost:8787/api/health
# → {"db":{"ok":true}}

# Whole chain: воркер → embed сервер → GPU
curl -H "Authorization: Bearer local-dev" \
  http://127.0.0.1:8000/embed \
  -F "image=@scripts/seeds/wikidata/photos/<any>.jpg"
# → {"embedding":[…1024 float…],"faceQuality":"high",…}

# Проверить что torch видит GPU
uv run --project scripts/seed/py python -c \
  "import torch; print(torch.cuda.get_device_name(0), torch.cuda.is_available())"
```

## Частые проблемы

- **`yunet_missing:<path>`** — не задан `YUNET_MODEL_PATH` или файл не скачан. См. «Однократная настройка» шаг 2.
- **`unauthorized` на воркере** — `MODAL_SHARED_SECRET` в `.dev.vars` не совпадает со значением `MODAL_SHARED_SECRET`, с которым запущен `local_server.py`. Должны быть одинаковые (у нас `local-dev`).
- **Воркер 503 на bulk-эндпоинтах** — если по какой-то причине `MODAL_EMBED_URL` указывает на прод-Modal, free-tier worker упирается в CPU. Проверь `.dev.vars`.
- **Enroll POST'ит в `starface.uz` вместо localhost** — забыл `PROD_URL=http://localhost:8787` перед командой. `.env.local` в `scripts/seed/py/` специально держит реальный прод — переопределяется через env-переменную только когда нужно.
- **Первый `uv sync` падает на сборке torch** — убедись что есть CUDA-драйвер (nvidia-smi). Индекс `pytorch-cu128` ожидает cu12.x driver.

## Откат к прод-Modal

Достаточно убрать / закомментировать в `.dev.vars`:

```ini
# MODAL_EMBED_URL=http://localhost:8000
# MODAL_SHARED_SECRET=local-dev
```

Локальный воркер упадёт с `MODAL_EMBED_URL not configured` (см. `apps/web/app/api/embed/proxy.ts:15`) — тогда поставь прод-значения через `wrangler secret list` / `wrangler secret get` (если есть доступ) или просто запускай без локального embed-слоя.

Прод-деплой `.dev.vars` **не затрагивает** — там используются `wrangler secret put` значения.

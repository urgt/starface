# StarFace UZ

B2B SaaS white-label платформа для киоск-развлечения «на кого ты похож из знаменитостей». Клиент-бренд получает URL, посетитель показывает ✌️ — получает результат с брендированным QR-кодом.

## Стек

- **Web** (`apps/web`): Next.js 15 (App Router, TS), Tailwind, Drizzle ORM, MediaPipe Tasks Web
- **ML** (`apps/ml`): FastAPI + InsightFace (ArcFace r50 `buffalo_l`)
- **БД**: PostgreSQL 16 + pgvector (HNSW) + Redis
- **Хранилище**: локальная ФС `./data` (в проде — S3-совместимое)

## Запуск одной командой

```bash
docker compose up --build
```

Compose поднимет:
- `postgres` (pgvector) и `redis` с healthcheck'ами
- `migrate` — one-shot, применяет схему + сидит демо-бренд `demo`
- `ml` — FastAPI+InsightFace (при первом запуске скачает ~300 МБ весов)
- `web` — Next.js с уже установленными зависимостями

После старта:
- Главная: <http://localhost:3000>
- Киоск (готов к использованию): <http://localhost:3000/kiosk?brand=demo>
- Админка: <http://localhost:3000/admin> (логин/пароль `admin` / `change-me` — поменяйте в `.env`)
- ML health: <http://localhost:8000/ml/health>
- Web health: <http://localhost:3000/api/health>

Переменные окружения (опционально) — в `.env` (см. `.env.example`).

> Первый `up --build` занимает ~3-5 мин (образы + `pnpm install`). Первый запрос `/api/match` ждёт загрузки ArcFace (~1-2 мин после старта ML).

## Первые шаги

1. Открыть `/kiosk?brand=demo` — демо-бренд уже создан миграцией
2. **Загрузить базу знаменитостей** (1 команда, ~15-30 мин):

   ```bash
   ./scripts/seed.sh
   # или только определённая категория:
   ./scripts/seed.sh --category uz     # ~300 узбекских
   ./scripts/seed.sh --category cis    # ~700 СНГ
   ./scripts/seed.sh --category world  # ~1500 мировых
   ```

   Скрипт внутри контейнера `ml`:
   - Запрашивает Wikidata SPARQL по категориям (актёры, музыканты, футболисты)
   - Скачивает портреты с Wikimedia Commons в `data/seeds/wikidata/photos/`
   - Прогоняет их через ArcFace и пишет в Postgres (пропускает фото без лица или с несколькими лицами)
   - Идемпотентен — повторный запуск докачивает/добавляет новое

3. Показать ✌️ в камеру → reveal → QR → мобильная страница

### Откуда данные

Wikidata SPARQL (`query.wikidata.org`) + изображения с Wikimedia Commons. Лицензии на фото в Commons обычно CC/PD — подходят для коммерческого использования (проверяйте для каждой фотографии при необходимости). Никакие API-ключи не нужны.

## Звук щёлчка затвора

Положите файл `shutter.mp3` в `apps/web/public/shutter.mp3` (любой короткий звук camera shutter).
Без файла киоск работает, просто без аудиооповещения.

## Приватность

Жест ✌️ = implicit consent (на киоске есть соответствующая надпись). Фото пользователя хранится 24 ч в `data/users/`, затем автоудаляется (вызов `POST /api/admin/cleanup` из крона). Embedding пользователя **в БД не сохраняется**.

## Запуск без Docker (для разработки)

```bash
cp .env.example .env

# ML
cd apps/ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# БД — применить миграции + сид
psql "$DATABASE_URL" -f docker/migrate-and-seed.sql

# Web (в другом терминале)
pnpm install
pnpm --filter @starface/web dev
```

## Верификация

- `curl http://localhost:8000/ml/health` → `{"status":"ok","model":"buffalo_l"}`
- `curl http://localhost:3000/api/health` → все чеки `ok`
- `psql ... -c "SELECT count(*) FROM celebrities;"` — счётчик знаменитостей
- `/admin` → графики аналитики после тестовых прогонов
- `/b/<brand>/analytics?t=<token>` — read-only версия для бренда (токен из таблицы `brands.analytics_token`)

## Монорепозиторий

```
apps/
  web/   — Next.js (kiosk, mobile result, admin)
  ml/    — FastAPI ML service + enroll CLI
data/    — загруженные фото (gitignored)
```

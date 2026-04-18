# @starface/scripts — local UI

Локальный web-интерфейс для запуска и мониторинга скриптов `fetch-wikidata`, `enroll`, `descriptions`.

## Запуск

```bash
pnpm install                 # из корня репо, если ещё не установлено
pnpm dev:ui                  # из корня (или pnpm --filter @starface/scripts dev:ui)
```

Откройте <http://127.0.0.1:5173>.

- `HOST` / `PORT` — env-переменные для переопределения (по умолчанию `127.0.0.1:5173`).
- Сервер биндится только на loopback. Не выставляйте в сеть — авторизации нет.

## Что умеет

- Форма аргументов для каждого скрипта (на основе `registry.ts`).
- Live-стрим stdout/stderr через SSE с авто-скроллом.
- Прогресс-бар из строк вида `[i/n]`.
- Статусы: выполняется / завершено / ошибка / остановлено / осиротевший.
- Кнопка «Остановить» (SIGTERM → SIGKILL через 5 сек).
- История запусков (`server/logs/<runId>.meta.json`).
- Скачивание полного лога (`server/logs/<runId>.log`).
- Просмотр `.seed-progress.json` прямо во view `enroll`.
- Проверка окружения: доступность `PROD_URL`, `LM_BASE_URL`, наличие ONNX-моделей, `.env.local`, статус секретов.

## Ограничения

- Один и тот же скрипт нельзя запустить дважды параллельно (409 → UI предложит открыть активный run).
- Ring-buffer живых логов в памяти: последние 2000 строк. Полный лог пишется в `server/logs/` без лимита.
- При Ctrl-C сервер гасит всех активных детей (SIGTERM). Если упал жёстко — при следующем старте такие run помечаются как `orphaned`.

## Файлы

- `index.ts` — entrypoint, graceful shutdown.
- `router.ts` — HTTP-диспетчер.
- `registry.ts` — описания скриптов и форм аргументов.
- `runs.ts` — RunManager: spawn, ring-buffer, SSE-подписчики, запись мета/логов.
- `sse.ts` — SSE-хелпер без зависимостей.
- `env-check.ts` — проверка окружения.
- `progress.ts` — чтение `.seed-progress.json`.
- `ui.html` — фронтенд (Tailwind CDN + vanilla ES-modules).
- `logs/` — генерируется на лету, в `.gitignore`.

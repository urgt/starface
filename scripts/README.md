# @starface/scripts — local seed tooling

Runs on the operator's machine. The kiosk's real-time ML lives on Modal
(`modal_app/`); this folder contains the offline pipeline that populates the
celebrity catalogue.

Pipeline:
1. `fetch-wikidata` (Node) — SPARQL + Wikimedia Commons → local photo cache + `manifest.json`.
2. `enroll` (Python, GPU) — runs `modal_app/pipeline.py` against the manifest and
   batches `POST /api/admin/enroll` with Basic Auth. Shares the exact pipeline
   with the Modal endpoint, so enrollment and request-time embeddings live in
   the same 1024-D space.
3. `descriptions` (Node) — Wikipedia intro + local OpenAI-compatible LLM
   (Ollama / LM Studio) → `PATCH /api/admin/celebrities/:id`.

## Setup

```bash
# Node side (fetch-wikidata, descriptions, dev:ui)
cd scripts && pnpm install
cp .env.example .env.local
$EDITOR .env.local   # PROD_URL + ADMIN_PASSWORD + LM_* + YUNET_MODEL_PATH

# YuNet detector (reused by Python enrollment via YUNET_MODEL_PATH)
mkdir -p models
curl -L -o models/yunet.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx

# Python side (enrollment). One-time; wheels are large (~6 GB).
cd seed/py
cp .env.example .env.local   # mirror PROD_URL + ADMIN_PASSWORD
uv sync
```

## Run

```bash
# 1) pull Wikidata metadata + download photos (resumable)
pnpm --filter @starface/scripts fetch-wikidata --category uz --limit 50

# 2) embed locally on GPU and push to prod (dry-run first)
pnpm --filter @starface/scripts enroll -- --category uz --limit 5 --dry-run
pnpm --filter @starface/scripts enroll -- --category uz

# 3) fill in missing UZ/RU/EN descriptions via local LLM
pnpm --filter @starface/scripts descriptions --limit 20
```

Progress is tracked in `scripts/seed/py/.seed-progress.json` (gitignored).
Pass `--reset-progress` to re-try entries that were skipped in a previous
dry-run.

## Notes

- `enroll` imports `modal_app/pipeline.py` directly. Any change to the pipeline
  (detector, alignment, embedding, quality scoring) requires a full re-enroll.
- `descriptions.ts` needs a local LM endpoint. Ollama default:
  `LM_BASE_URL=http://127.0.0.1:11434/v1`. LM Studio default:
  `http://127.0.0.1:1234/v1`.
- The legacy Node enrollment (`scripts/seed/enroll.ts` + MobileFaceNet) was
  removed on 2026-04-19. Git history has the old implementation if needed.

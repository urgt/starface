# @starface/scripts — local seed tooling

> **DEPRECATED (2026-04):** The online admin UI at `/admin/import` (bulk Wikidata
> import) and `/admin/celebrities/[id]` (per-celeb photo search + Gemini
> description generation) replaces this CLI pipeline. Keep this folder for
> offline operations during a Commons or Wikidata outage. No new features land
> here.

Runs on the operator's machine. **Does not run in Cloudflare Workers.**

Pipeline:
1. `fetch-wikidata` — SPARQL + Wikimedia Commons → local photo cache + `manifest.json`.
2. `enroll` — local ArcFace ONNX (YuNet detection + MobileFaceNet embedding) → batched `POST /api/admin/enroll` with Basic Auth.
3. `descriptions` — Wikipedia intro + local OpenAI-compatible LLM (Ollama / LM Studio) → `PATCH /api/admin/celebrities/:id`.

## Setup

```bash
# install deps
cd scripts && pnpm install

# configure
cp .env.example .env.local
$EDITOR .env.local   # set PROD_URL + ADMIN_PASSWORD + LM_*

# download ONNX models (identical to kiosk runtime)
mkdir -p models
# mobilefacenet.onnx — must match the file uploaded to R2 at models/mobilefacenet.onnx
curl -L -o models/mobilefacenet.onnx <your-mobilefacenet-url>
# YuNet face detector (OpenCV zoo)
curl -L -o models/yunet.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
```

## Run

```bash
# 1) pull Wikidata metadata + download photos (resumable)
pnpm --filter @starface/scripts fetch-wikidata --category uz --limit 50

# 2) embed locally and push to prod (dry-run first)
pnpm --filter @starface/scripts enroll --category uz --limit 5 --dry-run
pnpm --filter @starface/scripts enroll --category uz

# 3) fill in missing UZ/RU/EN descriptions via local LLM
pnpm --filter @starface/scripts descriptions --limit 20
```

Progress is tracked in `.seed-progress.json` in the cwd — rerun the command to resume from where it left off. Delete the file to start over.

## Notes

- The ONNX embedding pipeline must stay identical to `apps/web/lib/face-embed.ts` (same model file, same 112×112 preprocessing, same L2 normalization). If you change the model, re-enroll everything so vectors stay in one space.
- The prod worker never calls any LLM — descriptions are generated here and `PATCH`ed into D1.
- `descriptions.ts` requires a running local LM endpoint. Ollama default: `LM_BASE_URL=http://127.0.0.1:11434/v1`. LM Studio default: `http://127.0.0.1:1234/v1`.

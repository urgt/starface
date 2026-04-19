# starface seed (Python)

Local GPU enrollment. Reuses `modal_app/pipeline.py` so the embedding space
matches the Modal endpoint byte-for-byte.

## Setup

```bash
cd scripts/seed/py
cp .env.example .env.local
# Edit .env.local with your ADMIN_PASSWORD and the YuNet model path
uv sync          # installs torch + transformers + onnxruntime
```

## Usage

```bash
# First, fetch the Wikidata photos (uses the existing Node script):
pnpm --filter @starface/scripts fetch-wikidata --category uz --limit 100

# Then enroll them. Safe to re-run — resumes from .seed-progress.json.
uv run python enroll.py
uv run python enroll.py --category uz --limit 10 --dry-run
uv run python enroll.py --manifest /abs/path/to/manifest.json
```

## Notes

- The `embedding` field is now 1024-D (DINOv2). The old 512-D MobileFaceNet
  vectors are gone — `POST /api/admin/enroll` rejects anything else.
- Set `YUNET_MODEL_PATH` to reuse `scripts/models/yunet.onnx` instead of
  downloading a duplicate blob.
- First run downloads ~1.2 GB of DINOv2 weights into the HuggingFace cache;
  subsequent runs are fast.

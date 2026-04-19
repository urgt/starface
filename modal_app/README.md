# starface-ml (Modal app)

GPU inference for the kiosk. One container, one endpoint, L4 GPU, scale-to-zero.

## Pipeline

Selfie → YuNet detect + 5 keypoints → Umeyama similarity transform → 224×224
crop with 1.6× margin (DINOv2 needs the hair + chin context for wow-match) →
DINOv2 ViT-L/14 → 1024-D L2-normalized vector. In parallel, FairFace ViT
classifiers predict `sex ∈ {M,F}` and `age ∈ {0-2,3-9,…,70+}` (the age bucket is
mapped to its midpoint). Blur and frontal scores are computed on the aligned
crop and returned alongside the embedding so `/api/admin/enroll` can stuff them
into D1 for the quality-weighted rerank.

`/embed/burst` additionally averages up to N frames and rejects the capture if
the pairwise cosine between any two embeddings drops below `BURST_CONSISTENCY_THRESHOLD`
(0.85 by default) — prevents smeared identity when the user moved mid-shutter.

Licenses (all commercial-safe):
- YuNet — BSD (OpenCV zoo)
- DINOv2 ViT-L/14 — Apache 2.0 (Meta)
- `dima806/fairface_gender_image_detection`, `dima806/fairface_age_image_detection`
  — Apache 2.0 (HF, pulled automatically into `/hf-cache` volume on first request).

## Files

- `pipeline.py` — framework-agnostic pipeline, imported by both Modal and
  `scripts/seed/py/enroll.py`. No Modal decorators here.
- `modal_main.py` — Modal App definition + FastAPI `/embed`, `/embed/burst`,
  `/healthz`.
- `requirements.txt` — dependency pin for local dev. Modal installs from the
  `image.pip_install(...)` call.

## Secrets

Create once:

```bash
modal secret create starface-modal MODAL_SHARED_SECRET=<long-random>
```

The same value must be stored as a Cloudflare secret for the Next.js proxy:

```bash
cd apps/web
pnpm wrangler secret put MODAL_SHARED_SECRET
pnpm wrangler secret put MODAL_EMBED_URL   # e.g. https://<workspace>--starface-ml-inference-web.modal.run
```

## Deploy

```bash
pip install -r modal_app/requirements.txt
modal deploy modal_app/modal_main.py
```

Modal prints a URL like `https://<workspace>--starface-ml-inference-web.modal.run`.
Use it as `MODAL_EMBED_URL` on the Cloudflare side.

## Local smoke test

```bash
export YUNET_MODEL_PATH=$PWD/scripts/models/yunet.onnx   # reuse the existing blob
python - <<'PY'
from modal_app import pipeline
with open("me.jpg", "rb") as f:
    result = pipeline.process(f.read())
print(result.face_quality, len(result.embedding), result.det_score)
PY
```

## Warm vs cold

- Scale-to-zero by default (`min_containers` unset). `scaledown_window=180`
  drops the container after 3 min idle. To switch back to always-warm for a
  production launch: add `min_containers=1` to the `@app.cls(...)` decorator
  and redeploy (~$14/mo 24/7 for L4, ~$4/mo under a weekday schedule).
- Warm p95: YuNet ~30 ms + DINOv2 ViT-L ~120 ms → ~200 ms inference + 150–250 ms
  RTT from Cloudflare Pages ≈ 500 ms end-to-end.
- Cold start: 15–30 s on first request after idle (container boot + CUDA init +
  `pipeline.warm()` loads DINOv2 + FairFace from the HF volume). Kiosk users
  will feel this on the first shot of the day; subsequent shots within the
  `scaledown_window` are warm.

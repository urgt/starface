# starface-ml (Modal app)

GPU inference for the kiosk. One container, one endpoint, L4 GPU, warm 24/7.

## Pipeline

Selfie → YuNet detect + 5 keypoints → Umeyama similarity transform → 224×224
crop → DINOv2 ViT-L/14 → 1024-D L2-normalized vector.

Licenses (all commercial-safe): YuNet (BSD), DINOv2 (Apache 2.0), FairFace
weights slot (CC-BY 4.0) is a TODO in `pipeline.predict_attrs`.

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

- `min_containers=1` keeps one L4 warm → ~$14/mo 24/7 or ~$4/mo under a weekday
  schedule. Set it via Modal's dashboard or `schedules=[]` if the kiosk has
  known operating hours.
- Warm p95: YuNet ~30 ms + DINOv2 ViT-L ~120 ms → ~200 ms inference + 150–250 ms
  RTT from Cloudflare Pages ≈ 500 ms end-to-end.
- Cold start: 2–4 s (image pull + HF cache hydrate from Volume).

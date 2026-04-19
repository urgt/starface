"""Modal deployment for the StarFace ML pipeline.

POST /embed         — multipart `image` → 1024-D DINOv2 embedding + metadata
POST /embed/burst   — multipart `images` (≥1) → averaged embedding
GET  /healthz       — readiness probe

Auth: `Authorization: Bearer $MODAL_SHARED_SECRET` (from the `starface-modal` secret).

Deploy: `uv run modal deploy modal_app/modal_main.py`
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import modal

HERE = Path(__file__).parent
YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/"
    "models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0", "curl")
    .pip_install(
        "torch==2.2.2",
        "torchvision==0.17.2",
        "transformers>=4.40,<5",
        "onnxruntime-gpu==1.17.1",
        "pillow>=10.0",
        "numpy>=1.26,<2",
        "starlette>=0.37",
        "python-multipart>=0.0.9",
    )
    .run_commands(
        "mkdir -p /root/models",
        f"curl -fsSL -o /root/models/yunet.onnx {YUNET_URL}",
    )
    .env(
        {
            "YUNET_MODEL_PATH": "/root/models/yunet.onnx",
            "HF_HOME": "/hf-cache",
            "TRANSFORMERS_CACHE": "/hf-cache",
        }
    )
    .add_local_file(
        local_path=str(HERE / "pipeline.py"),
        remote_path="/root/pipeline.py",
    )
)

app = modal.App("starface-ml", image=image)
HF_CACHE = modal.Volume.from_name("starface-hf-cache", create_if_missing=True)
SECRET = modal.Secret.from_name("starface-modal")


@app.cls(
    gpu="L4",
    min_containers=1,
    scaledown_window=300,
    timeout=120,
    volumes={"/hf-cache": HF_CACHE},
    secrets=[SECRET],
)
class Inference:
    @modal.enter()
    def load(self) -> None:
        sys.path.insert(0, "/root")
        import pipeline  # type: ignore[import-not-found]

        pipeline.warm()
        self.pipeline = pipeline

    @modal.asgi_app()
    def web(self):
        # Raw Starlette avoids FastAPI's pydantic-2.13 introspection bug where
        # `Request` / `UploadFile` in endpoint signatures are treated as query
        # params and blow up with `TypeAdapter is not fully defined`.
        from starlette.applications import Starlette
        from starlette.responses import JSONResponse
        from starlette.routing import Route

        shared_secret = os.environ.get("MODAL_SHARED_SECRET")
        pipeline = self.pipeline

        def _unauthorized() -> JSONResponse:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)

        def _check_auth(request) -> JSONResponse | None:
            if not shared_secret:
                return JSONResponse(
                    {"detail": "server_misconfigured"}, status_code=500
                )
            if request.headers.get("authorization") != f"Bearer {shared_secret}":
                return _unauthorized()
            return None

        def _serialize(result) -> dict:
            return {
                "embedding": result.embedding,
                "bbox": list(result.bbox),
                "detScore": result.det_score,
                "faceQuality": result.face_quality,
                "sex": result.sex,
                "age": result.age,
            }

        async def healthz(_request) -> JSONResponse:
            return JSONResponse({"ok": True, "embeddingDim": pipeline.EMBEDDING_DIM})

        async def embed(request) -> JSONResponse:
            bad = _check_auth(request)
            if bad is not None:
                return bad
            form = await request.form()
            upload = form.get("image")
            if upload is None or not hasattr(upload, "read"):
                return JSONResponse({"detail": "missing_image"}, status_code=400)
            data = await upload.read()
            try:
                result = pipeline.process(data)
            except pipeline.FaceEmbedError as exc:
                return JSONResponse({"detail": exc.code}, status_code=422)
            return JSONResponse(_serialize(result))

        async def embed_burst(request) -> JSONResponse:
            bad = _check_auth(request)
            if bad is not None:
                return bad
            form = await request.form()
            uploads = form.getlist("images")
            bufs: list[bytes] = []
            for u in uploads:
                if hasattr(u, "read"):
                    bufs.append(await u.read())
            if not bufs:
                return JSONResponse({"detail": "missing_images"}, status_code=400)
            try:
                result = pipeline.process_burst(bufs)
            except pipeline.FaceEmbedError as exc:
                return JSONResponse({"detail": exc.code}, status_code=422)
            return JSONResponse(_serialize(result))

        return Starlette(
            routes=[
                Route("/healthz", healthz, methods=["GET"]),
                Route("/embed", embed, methods=["POST"]),
                Route("/embed/burst", embed_burst, methods=["POST"]),
            ]
        )

"""Local drop-in replacement for the Modal embed service.

Exposes the same HTTP interface as `modal_main.py` (`POST /embed`,
`POST /embed/burst`, `GET /healthz`, Bearer auth) so the Cloudflare worker's
`/api/embed(/burst)` proxy can point at `http://localhost:8000` during local
development and skip the paid Modal round-trip.

Uses `modal_app.pipeline` directly — byte-identical embeddings to prod.

Run:
    cd scripts/seed/py
    MODAL_SHARED_SECRET=local-dev uv run python -m modal_app.local_server
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(REPO_ROOT))


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(REPO_ROOT / "scripts" / "seed" / "py" / ".env.local")

from modal_app import pipeline  # noqa: E402


def _serialize(result) -> dict:
    return {
        "embedding": result.embedding,
        "bbox": list(result.bbox),
        "detScore": result.det_score,
        "faceQuality": result.face_quality,
        "blurScore": result.blur_score,
        "frontalScore": result.frontal_score,
        "sex": result.sex,
        "age": result.age,
    }


def _check_auth(request: Request) -> JSONResponse | None:
    expected = os.environ.get("MODAL_SHARED_SECRET")
    if not expected:
        return JSONResponse({"detail": "server_misconfigured"}, status_code=500)
    if request.headers.get("authorization") != f"Bearer {expected}":
        return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return None


async def healthz(_request: Request) -> JSONResponse:
    return JSONResponse({"ok": True, "embeddingDim": pipeline.EMBEDDING_DIM})


async def embed(request: Request) -> JSONResponse:
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


async def embed_burst(request: Request) -> JSONResponse:
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


app = Starlette(
    routes=[
        Route("/healthz", healthz, methods=["GET"]),
        Route("/embed", embed, methods=["POST"]),
        Route("/embed/burst", embed_burst, methods=["POST"]),
    ]
)


def main() -> None:
    pipeline.warm()
    host = os.environ.get("LOCAL_EMBED_HOST", "127.0.0.1")
    port = int(os.environ.get("LOCAL_EMBED_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()

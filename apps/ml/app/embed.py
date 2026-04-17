"""ArcFace embedding wrapper around InsightFace buffalo_l."""

from __future__ import annotations

import base64
import io
import threading
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps


_app_lock = threading.Lock()
_app = None


def _get_app():
    """Lazy-initialise InsightFace FaceAnalysis (RetinaFace detector + ArcFace r50)."""
    global _app
    if _app is not None:
        return _app
    with _app_lock:
        if _app is not None:
            return _app
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=0, det_size=(640, 640))
        _app = app
    return _app


def get_face_analyzer():
    """Public accessor for the FaceAnalysis singleton (reused by enrich pipeline)."""
    return _get_app()


def warmup() -> None:
    """Trigger model load on service start so first real request is fast."""
    _get_app()


@dataclass
class EmbedResult:
    embedding: list[float]
    bbox: list[float]
    det_score: float
    face_quality: str


class NoFaceError(ValueError):
    pass


class MultipleFacesError(ValueError):
    pass


class LowQualityError(ValueError):
    pass


def _decode_base64(image_base64: str) -> Image.Image:
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]
    raw = base64.b64decode(image_base64)
    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img).convert("RGB")
    return img


def _pick_face(faces, image_rgb: np.ndarray, allow_multiple: bool):
    if not faces:
        raise NoFaceError("no_face")
    if len(faces) > 1 and not allow_multiple:
        h, w = image_rgb.shape[:2]
        cx, cy = w / 2, h / 2

        def centrality(f):
            x1, y1, x2, y2 = f.bbox
            fx, fy = (x1 + x2) / 2, (y1 + y2) / 2
            return (fx - cx) ** 2 + (fy - cy) ** 2

        faces = sorted(faces, key=centrality)
    return faces[0]


def embed_image(image_base64: str, allow_multiple: bool = False) -> EmbedResult:
    """Decode image → detect face → return normalised 512-d ArcFace embedding.

    Raises NoFaceError / MultipleFacesError / LowQualityError.
    """
    app = _get_app()
    pil = _decode_base64(image_base64)
    rgb = np.array(pil)
    # InsightFace expects BGR
    bgr = rgb[:, :, ::-1]

    faces = app.get(bgr)
    face = _pick_face(faces, rgb, allow_multiple)

    if face.det_score < 0.5:
        raise LowQualityError("low_detection_score")

    x1, y1, x2, y2 = face.bbox
    face_w = max(0.0, x2 - x1)
    face_h = max(0.0, y2 - y1)
    if min(face_w, face_h) < 60:
        raise LowQualityError("face_too_small")

    emb = face.normed_embedding
    if emb is None:
        raise LowQualityError("no_embedding")

    quality = "high"
    if face.det_score < 0.75 or min(face_w, face_h) < 120:
        quality = "medium"

    return EmbedResult(
        embedding=emb.astype(np.float32).tolist(),
        bbox=[float(x1), float(y1), float(x2), float(y2)],
        det_score=float(face.det_score),
        face_quality=quality,
    )

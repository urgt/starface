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
    sex: str | None = None
    age: int | None = None


@dataclass
class EmbedBatchResult:
    """Averaged template embedding built from a burst of selfies.

    `embedding` is the L2-normalised mean of the `accepted` frames' embeddings
    (1 ≤ accepted ≤ len(images)). `best_frame_index` points at the highest-quality
    frame (max det_score) and its metadata is echoed at the top level so the
    caller can persist just that frame.
    """

    embedding: list[float]
    best_frame_index: int
    accepted: int
    rejected: list[dict]
    bbox: list[float]
    det_score: float
    face_quality: str
    sex: str | None = None
    age: int | None = None


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

    sex = getattr(face, "sex", None)
    age = getattr(face, "age", None)
    sex_value = sex if sex in ("M", "F") else None
    age_value: int | None
    try:
        age_value = int(age) if age is not None else None
    except (TypeError, ValueError):
        age_value = None

    return EmbedResult(
        embedding=emb.astype(np.float32).tolist(),
        bbox=[float(x1), float(y1), float(x2), float(y2)],
        det_score=float(face.det_score),
        face_quality=quality,
        sex=sex_value,
        age=age_value,
    )


def embed_images_batch(
    images_base64: list[str], allow_multiple: bool = False
) -> EmbedBatchResult:
    """Process a burst of selfies → averaged template embedding.

    Each frame is passed through `embed_image`. Frames that fail the per-frame
    quality gate (`NoFaceError`, `MultipleFacesError`, `LowQualityError`) are
    collected in `rejected` and skipped. Accepted frames' unit embeddings are
    averaged and re-normalised. The frame with the highest `det_score` is
    chosen as the "best" frame and its attributes (bbox, quality, sex, age)
    are echoed on the batch result — callers persist only that frame.

    Raises NoFaceError (code="all_frames_rejected") if no frame passes.
    """
    if not images_base64:
        raise NoFaceError("no_images")

    accepted: list[tuple[int, EmbedResult]] = []
    rejected: list[dict] = []
    for idx, img_b64 in enumerate(images_base64):
        try:
            res = embed_image(img_b64, allow_multiple=allow_multiple)
        except NoFaceError as e:
            rejected.append({"index": idx, "code": "no_face", "message": str(e)})
            continue
        except MultipleFacesError as e:
            rejected.append({"index": idx, "code": "multiple_faces", "message": str(e)})
            continue
        except LowQualityError as e:
            rejected.append({"index": idx, "code": "low_quality", "message": str(e)})
            continue
        accepted.append((idx, res))

    if not accepted:
        # Expose the most informative rejection so the UI can hint the user.
        raise NoFaceError("all_frames_rejected")

    vectors = np.asarray([r.embedding for _, r in accepted], dtype=np.float32)
    mean = vectors.mean(axis=0)
    norm = float(np.linalg.norm(mean))
    if norm < 1e-8:
        # Extremely unlikely (would mean the accepted vectors cancel out).
        raise LowQualityError("embedding_collapse")
    template = (mean / norm).tolist()

    best_idx_local = max(range(len(accepted)), key=lambda i: accepted[i][1].det_score)
    best_frame_index, best = accepted[best_idx_local]

    # Prefer non-null sex/age from the best frame; fall back to any accepted
    # frame so downstream code still gets the attribute even if the sharpest
    # frame happened to miss it.
    sex = best.sex
    age = best.age
    if sex is None:
        sex = next((r.sex for _, r in accepted if r.sex is not None), None)
    if age is None:
        age = next((r.age for _, r in accepted if r.age is not None), None)

    return EmbedBatchResult(
        embedding=template,
        best_frame_index=best_frame_index,
        accepted=len(accepted),
        rejected=rejected,
        bbox=best.bbox,
        det_score=best.det_score,
        face_quality=best.face_quality,
        sex=sex,
        age=age,
    )

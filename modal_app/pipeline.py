"""Shared face pipeline used by both the Modal endpoint and local enrollment.

Commercial-safe stack:
- YuNet (BSD) detection + 5 keypoints
- Umeyama similarity transform to a scaled ArcFace template
- DINOv2 ViT-L/14 (Apache 2.0) CLS token → 1024-D L2-normalized vector

No Modal decorators here — keep this module framework-agnostic so the same
code runs on Modal and on a local GPU via `scripts/seed/py/enroll.py`.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import (
    AutoImageProcessor,
    AutoModel,
    AutoModelForImageClassification,
)

def _env(key: str, default: str) -> str:
    """Read env lazily so callers can set variables after this module imports."""
    return os.environ.get(key, default)


_DINOV2_DEFAULT = "facebook/dinov2-large"
_YUNET_DEFAULT = str(Path(__file__).parent / "models" / "yunet.onnx")
_AGE_MODEL_DEFAULT = "dima806/fairface_age_image_detection"
_GENDER_MODEL_DEFAULT = "dima806/fairface_gender_image_detection"

# id2label on fairface_age maps bucket → age midpoint (use center of range,
# 70+ → 75 as a reasonable proxy).
_AGE_BUCKET_TO_YEARS = {
    "0-2": 1,
    "3-9": 6,
    "10-19": 15,
    "20-29": 25,
    "30-39": 35,
    "40-49": 45,
    "50-59": 55,
    "60-69": 65,
    "more than 70": 75,
}


def _dinov2_name() -> str:
    return _env("DINOV2_MODEL", _DINOV2_DEFAULT)


def _yunet_path() -> str:
    return _env("YUNET_MODEL_PATH", _YUNET_DEFAULT)


def _age_model_name() -> str:
    return _env("FAIRFACE_AGE_MODEL", _AGE_MODEL_DEFAULT)


def _gender_model_name() -> str:
    return _env("FAIRFACE_GENDER_MODEL", _GENDER_MODEL_DEFAULT)

EMBEDDING_DIM = 1024
YUNET_INPUT = 640
CROP_SIZE = 224
CROP_MARGIN = 1.6
DET_THR = 0.6
NMS_IOU = 0.3

# ArcFace canonical 5-point template in 112×112 space, scaled and centered so the
# face occupies CROP_SIZE / CROP_MARGIN pixels of a CROP_SIZE×CROP_SIZE output.
_ARCFACE_112 = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [73.7299, 92.2041],
    ],
    dtype=np.float32,
)
_FACE_TARGET = CROP_SIZE / CROP_MARGIN
_TEMPLATE_SCALE = _FACE_TARGET / 112.0
_TEMPLATE_OFFSET = (CROP_SIZE - 112.0 * _TEMPLATE_SCALE) / 2.0
CANONICAL_5 = _ARCFACE_112 * _TEMPLATE_SCALE + _TEMPLATE_OFFSET


class FaceEmbedError(Exception):
    """Structured error whose `.code` maps to kiosk UX strings."""

    def __init__(self, code: str, message: str | None = None) -> None:
        super().__init__(message or code)
        self.code = code  # no_face | multiple_faces | low_quality | internal


@dataclass
class Detection:
    bbox: tuple[float, float, float, float]
    score: float
    keypoints: np.ndarray


@dataclass
class EmbedResult:
    embedding: list[float]
    bbox: tuple[float, float, float, float]
    det_score: float
    face_quality: str
    blur_score: float
    frontal_score: float
    sex: str | None
    age: int | None


def _ort_providers() -> list[str]:
    available = ort.get_available_providers()
    ordered = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]
    return ordered or ["CPUExecutionProvider"]


@lru_cache(maxsize=1)
def _yunet() -> ort.InferenceSession:
    path = _yunet_path()
    if not Path(path).exists():
        raise FaceEmbedError("internal", f"yunet_missing:{path}")
    return ort.InferenceSession(path, providers=_ort_providers())


@lru_cache(maxsize=1)
def _dinov2() -> tuple[AutoImageProcessor, AutoModel, torch.device]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    name = _dinov2_name()
    processor = AutoImageProcessor.from_pretrained(name)
    model = AutoModel.from_pretrained(name).to(device).eval()
    return processor, model, device


@lru_cache(maxsize=2)
def _fairface_classifier(
    name: str,
) -> tuple[AutoImageProcessor, AutoModelForImageClassification, torch.device]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    processor = AutoImageProcessor.from_pretrained(name)
    model = AutoModelForImageClassification.from_pretrained(name).to(device).eval()
    return processor, model, device


def warm() -> None:
    """Best-effort warm-up; call from @modal.enter()."""
    _yunet()
    _dinov2()
    try:
        _fairface_classifier(_age_model_name())
        _fairface_classifier(_gender_model_name())
    except Exception as exc:
        # Attribute heads are optional — log and continue.
        print(f"fairface warm failed: {exc}")


def _letterbox(image: Image.Image, size: int) -> tuple[np.ndarray, float]:
    w, h = image.size
    scale = min(size / w, size / h)
    new_w, new_h = int(round(w * scale)), int(round(h * scale))
    resized = image.resize((new_w, new_h), Image.BILINEAR).convert("RGB")
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    canvas.paste(resized, (0, 0))
    return np.asarray(canvas), scale


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax2, ay2 = a[0] + a[2], a[1] + a[3]
    bx2, by2 = b[0] + b[2], b[1] + b[3]
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def _nms(dets: list[Detection], iou_thr: float) -> list[Detection]:
    dets = sorted(dets, key=lambda d: d.score, reverse=True)
    keep: list[Detection] = []
    for d in dets:
        if any(_iou(d.bbox, k.bbox) > iou_thr for k in keep):
            continue
        keep.append(d)
    return keep


def _decode_yunet(
    outputs: dict[str, np.ndarray], input_size: int, scale: float
) -> list[Detection]:
    strides = [8, 16, 32]
    result: list[Detection] = []
    for stride in strides:
        cls_name = next(
            (n for n in (f"cls_{stride}", f"conf_{stride}") if n in outputs),
            None,
        )
        bbox_name = next(
            (n for n in (f"bbox_{stride}", f"loc_{stride}") if n in outputs),
            None,
        )
        obj_name = f"obj_{stride}" if f"obj_{stride}" in outputs else None
        kps_name = next(
            (n for n in (f"kps_{stride}", f"landmark_{stride}") if n in outputs),
            None,
        )
        if not cls_name or not bbox_name:
            continue
        cls = np.asarray(outputs[cls_name]).reshape(-1)
        obj = np.asarray(outputs[obj_name]).reshape(-1) if obj_name else np.ones_like(cls)
        bbox = np.asarray(outputs[bbox_name]).reshape(-1, 4)
        kps = np.asarray(outputs[kps_name]).reshape(-1, 10) if kps_name else None

        grid = input_size // stride
        for i, (c_i, o_i) in enumerate(zip(cls, obj)):
            score = float(c_i * o_i)
            if score < DET_THR:
                continue
            gy, gx = divmod(i, grid)
            cx = (gx + bbox[i, 0]) * stride
            cy = (gy + bbox[i, 1]) * stride
            w = float(np.exp(bbox[i, 2])) * stride
            h = float(np.exp(bbox[i, 3])) * stride
            x = (cx - w / 2) / scale
            y = (cy - h / 2) / scale
            bw, bh = w / scale, h / scale
            if kps is not None:
                pts = np.empty((5, 2), dtype=np.float32)
                for k in range(5):
                    pts[k, 0] = (gx + kps[i, k * 2]) * stride / scale
                    pts[k, 1] = (gy + kps[i, k * 2 + 1]) * stride / scale
            else:
                pts = np.zeros((5, 2), dtype=np.float32)
            result.append(Detection(bbox=(x, y, bw, bh), score=score, keypoints=pts))
    return _nms(result, NMS_IOU)


def detect(image: Image.Image) -> list[Detection]:
    letterboxed, scale = _letterbox(image, YUNET_INPUT)
    # YuNet expects BGR NCHW float32.
    bgr = letterboxed[:, :, ::-1].astype(np.float32)
    chw = np.transpose(bgr, (2, 0, 1))[None, ...]
    session = _yunet()
    input_name = session.get_inputs()[0].name
    out_names = [o.name for o in session.get_outputs()]
    outputs = session.run(None, {input_name: chw})
    return _decode_yunet(dict(zip(out_names, outputs)), YUNET_INPUT, scale)


def _umeyama(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares similarity (scale + rotation + translation) mapping src→dst."""
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    n = src.shape[0]
    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)
    src_c = src - src_mean
    dst_c = dst - dst_mean
    cov = dst_c.T @ src_c / n
    U, S, Vt = np.linalg.svd(cov)
    D = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[-1, -1] = -1
    R = U @ D @ Vt
    var_src = (src_c**2).sum() / n
    scale = float((S * np.diag(D)).sum() / var_src) if var_src > 0 else 1.0
    t = dst_mean - scale * (R @ src_mean)
    M = np.zeros((2, 3), dtype=np.float32)
    M[:2, :2] = (scale * R).astype(np.float32)
    M[:, 2] = t.astype(np.float32)
    return M


def align_crop(
    image: Image.Image, detection: Detection, size: int = CROP_SIZE
) -> Image.Image:
    if np.any(detection.keypoints):
        M = _umeyama(detection.keypoints, CANONICAL_5)
        # PIL.AFFINE uses inverse mapping: (out_x, out_y) → (src_x, src_y).
        forward = np.vstack([M, [0.0, 0.0, 1.0]])
        inverse = np.linalg.inv(forward)[:2]
        coeffs = tuple(float(v) for v in inverse.flatten())
        return image.transform(
            (size, size),
            Image.AFFINE,
            data=coeffs,
            resample=Image.BILINEAR,
            fillcolor=(0, 0, 0),
        ).convert("RGB")
    # Keypoints missing — fall back to a padded center crop.
    x, y, w, h = detection.bbox
    cx, cy = x + w / 2, y + h / 2
    half = max(w, h) * CROP_MARGIN / 2
    left = max(0.0, cx - half)
    top = max(0.0, cy - half)
    right = min(float(image.width), cx + half)
    bottom = min(float(image.height), cy + half)
    crop = image.crop((int(left), int(top), int(right), int(bottom)))
    return crop.resize((size, size), Image.BILINEAR).convert("RGB")


def embed(crop: Image.Image) -> np.ndarray:
    processor, model, device = _dinov2()
    inputs = processor(images=crop, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)
    cls = outputs.last_hidden_state[:, 0]
    cls = F.normalize(cls, p=2, dim=1)
    return cls.cpu().numpy().reshape(-1).astype(np.float32)


_LAPLACIAN_KERNEL = np.array(
    [[0.0, 1.0, 0.0], [1.0, -4.0, 1.0], [0.0, 1.0, 0.0]], dtype=np.float32
)


def blur_score(crop: Image.Image) -> float:
    """Laplacian variance on the aligned grayscale face. 0 = sharp, 1 = blurry."""
    gray = np.asarray(crop.convert("L"), dtype=np.float32)
    # 2D convolution via reflect-padded slicing — no scipy dependency.
    padded = np.pad(gray, 1, mode="reflect")
    lap = (
        _LAPLACIAN_KERNEL[1, 1] * padded[1:-1, 1:-1]
        + _LAPLACIAN_KERNEL[0, 1] * padded[0:-2, 1:-1]
        + _LAPLACIAN_KERNEL[2, 1] * padded[2:, 1:-1]
        + _LAPLACIAN_KERNEL[1, 0] * padded[1:-1, 0:-2]
        + _LAPLACIAN_KERNEL[1, 2] * padded[1:-1, 2:]
    )
    variance = float(lap.var())
    # variance typically 500+ on sharp faces, <100 on soft/out-of-focus.
    return float(max(0.0, min(1.0, 1.0 - variance / 300.0)))


def frontal_score(keypoints: np.ndarray) -> float:
    """0 = extreme tilt / profile, 1 = perfectly frontal."""
    if not np.any(keypoints) or keypoints.shape[0] < 5:
        return 1.0
    left_eye, right_eye, nose, left_mouth, right_mouth = keypoints[:5]
    # Eye-line tilt penalty
    dx, dy = right_eye[0] - left_eye[0], right_eye[1] - left_eye[1]
    tilt = abs(np.arctan2(dy, dx))  # radians
    tilt_score = float(max(0.0, 1.0 - tilt / (np.pi / 4)))  # > 45° → 0
    # Horizontal symmetry of eyes + mouth around nose (yaw proxy)
    eye_symmetry = (
        (nose[0] - left_eye[0]) - (right_eye[0] - nose[0])
    ) / max(1.0, right_eye[0] - left_eye[0])
    mouth_symmetry = (
        (nose[0] - left_mouth[0]) - (right_mouth[0] - nose[0])
    ) / max(1.0, right_mouth[0] - left_mouth[0])
    yaw = (abs(eye_symmetry) + abs(mouth_symmetry)) / 2
    yaw_score = float(max(0.0, 1.0 - min(1.0, yaw * 2.0)))
    return float(max(0.0, min(1.0, tilt_score * 0.5 + yaw_score * 0.5)))


def _run_fairface(crop: Image.Image, name: str) -> dict[str, float]:
    processor, model, device = _fairface_classifier(name)
    inputs = processor(images=crop, return_tensors="pt").to(device)
    with torch.no_grad():
        logits = model(**inputs).logits
    probs = F.softmax(logits, dim=1)[0].cpu().numpy()
    labels = model.config.id2label
    return {labels[i]: float(probs[i]) for i in range(len(probs))}


def predict_attrs(crop: Image.Image) -> tuple[str | None, int | None]:
    """Gender / age prediction via FairFace ViT classifiers (Apache 2.0).

    Returns (None, None) if the models fail to load or infer — rerank in
    /api/match falls through gracefully on null inputs.
    """
    try:
        gender = _run_fairface(crop, _gender_model_name())
        age = _run_fairface(crop, _age_model_name())
    except Exception as exc:
        print(f"predict_attrs failed: {exc}")
        return None, None

    sex = "M" if gender.get("Male", 0) >= gender.get("Female", 0) else "F"
    top_bucket = max(age, key=age.get)
    years = _AGE_BUCKET_TO_YEARS.get(top_bucket)
    return sex, years


def process(image_bytes: bytes) -> EmbedResult:
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        raise FaceEmbedError("internal", f"image_decode:{exc}") from exc

    detections = detect(image)
    if not detections:
        raise FaceEmbedError("no_face")
    if len(detections) > 1:
        raise FaceEmbedError("multiple_faces")
    detection = detections[0]
    if detection.score < DET_THR:
        raise FaceEmbedError("low_quality")

    crop = align_crop(image, detection)
    vector = embed(crop)
    if vector.shape[0] != EMBEDDING_DIM:
        raise FaceEmbedError("internal", f"unexpected_dim_{vector.shape[0]}")

    sex, age = predict_attrs(crop)
    blur = blur_score(crop)
    frontal = frontal_score(detection.keypoints)

    _, _, bw, bh = detection.bbox
    face_quality = "high" if min(bw, bh) >= 96 and detection.score >= 0.85 else "medium"

    return EmbedResult(
        embedding=vector.tolist(),
        bbox=detection.bbox,
        det_score=detection.score,
        face_quality=face_quality,
        blur_score=blur,
        frontal_score=frontal,
        sex=sex,
        age=age,
    )


BURST_CONSISTENCY_THRESHOLD = 0.85


def process_burst(images: list[bytes]) -> EmbedResult:
    results: list[EmbedResult] = []
    last_error: FaceEmbedError | None = None
    for buf in images:
        try:
            results.append(process(buf))
        except FaceEmbedError as exc:
            last_error = exc
    if not results:
        raise last_error or FaceEmbedError("no_face")

    # Reject bursts where the user moved / lighting changed mid-capture —
    # averaging inconsistent embeddings just smears identity.
    if len(results) >= 2:
        vectors = [np.asarray(r.embedding, dtype=np.float32) for r in results]
        min_pair_cos = 1.0
        for i in range(len(vectors)):
            for j in range(i + 1, len(vectors)):
                min_pair_cos = min(min_pair_cos, float(np.dot(vectors[i], vectors[j])))
        if min_pair_cos < BURST_CONSISTENCY_THRESHOLD:
            raise FaceEmbedError("burst_inconsistent")

    summed = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    for r in results:
        summed += np.asarray(r.embedding, dtype=np.float32)
    norm = float(np.linalg.norm(summed))
    if norm > 0:
        summed /= norm

    best = max(results, key=lambda r: r.det_score)
    face_quality = (
        "high" if all(r.face_quality == "high" for r in results) else "medium"
    )
    mean_blur = float(np.mean([r.blur_score for r in results]))
    mean_frontal = float(np.mean([r.frontal_score for r in results]))
    return EmbedResult(
        embedding=summed.tolist(),
        bbox=best.bbox,
        det_score=best.det_score,
        face_quality=face_quality,
        blur_score=mean_blur,
        frontal_score=mean_frontal,
        sex=best.sex,
        age=best.age,
    )

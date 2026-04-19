"""End-to-end smoke test for the StarFace pipeline.

Run from this directory after `uv sync`:
    uv run python smoke_test.py                      # import + CUDA check
    uv run python smoke_test.py path/to/photo.jpg    # full pipeline on one photo
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from time import perf_counter


def _prepare_paths() -> None:
    here = Path(__file__).resolve().parent
    repo_root = here.parents[2]
    sys.path.insert(0, str(repo_root))
    # Fall back to the existing Node-side YuNet blob so users don't need to
    # duplicate the file under modal_app/models/ for local smoke tests.
    default_yunet = repo_root / "scripts" / "models" / "yunet.onnx"
    if default_yunet.exists() and not os.environ.get("YUNET_MODEL_PATH"):
        os.environ["YUNET_MODEL_PATH"] = str(default_yunet)


def main() -> int:
    _prepare_paths()

    import torch

    print(f"torch={torch.__version__} cuda={torch.cuda.is_available()}", flush=True)
    if torch.cuda.is_available():
        print(f"  device={torch.cuda.get_device_name(0)}", flush=True)

    from modal_app import pipeline

    print(f"pipeline.EMBEDDING_DIM={pipeline.EMBEDDING_DIM}", flush=True)
    print(f"YUNET_MODEL_PATH={pipeline._yunet_path()}", flush=True)

    if len(sys.argv) < 2:
        print("no image supplied — skipping inference", flush=True)
        return 0

    photo = Path(sys.argv[1])
    if not photo.exists():
        print(f"photo not found: {photo}", flush=True)
        return 1

    print(f"loading models + running on {photo.name} …", flush=True)
    t0 = perf_counter()
    pipeline.warm()
    t_warm = perf_counter() - t0

    t1 = perf_counter()
    result = pipeline.process(photo.read_bytes())
    t_proc = perf_counter() - t1

    print(f"  warm: {t_warm:.2f}s  process: {t_proc * 1000:.0f}ms", flush=True)
    print(
        f"  detScore={result.det_score:.2f} "
        f"faceQuality={result.face_quality} "
        f"embeddingDim={len(result.embedding)} "
        f"sex={result.sex} age={result.age}",
        flush=True,
    )
    norm = sum(v * v for v in result.embedding) ** 0.5
    print(f"  embedding L2 norm = {norm:.4f} (should be ~1.0)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

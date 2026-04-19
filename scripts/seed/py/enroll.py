"""Local GPU enrollment for StarFace celebrities.

Reads a manifest produced by `scripts/seed/wikidata-cli.ts`, runs the exact same
pipeline that Modal uses (via `modal_app.pipeline`), and posts 1024-D embeddings
to `POST /api/admin/enroll` on prod. Resumable via `.seed-progress.json`.

Usage:
    # Once: create `.env.local` next to this file with PROD_URL, ADMIN_USER,
    # ADMIN_PASSWORD, YUNET_MODEL_PATH (point at scripts/models/yunet.onnx).
    uv run python enroll.py --manifest ../../seeds/wikidata/manifest.json
    uv run python enroll.py --category uz --limit 20 --dry-run
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

import requests

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
sys.path.insert(0, str(REPO_ROOT))

from modal_app import pipeline  # noqa: E402

BATCH_SIZE = 25


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


def _load_progress(path: Path) -> dict[str, list]:
    if not path.exists():
        return {"done": [], "failed": []}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {"done": [], "failed": []}


def _save_progress(path: Path, progress: dict[str, list]) -> None:
    path.write_text(json.dumps(progress, indent=2))


def _ext(photo_path: str) -> str:
    ext = Path(photo_path).suffix.lstrip(".").lower()
    return ext if ext in {"jpg", "jpeg", "png", "webp"} else "jpg"


def _post_batch(prod_url: str, auth: tuple[str, str], batch: list[dict[str, Any]]) -> dict:
    resp = requests.post(
        f"{prod_url.rstrip('/')}/api/admin/enroll",
        json={"celebrities": batch},
        auth=auth,
        timeout=120,
    )
    if not resp.ok:
        raise RuntimeError(f"enroll HTTP {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _flush(
    prod_url: str,
    auth: tuple[str, str],
    batch: list[dict[str, Any]],
    progress: dict[str, list],
    progress_path: Path,
    dry_run: bool,
) -> None:
    if dry_run:
        print(f"  [dry-run] would POST {len(batch)} celebrities")
        return
    result = _post_batch(prod_url, auth, batch)
    print(
        f"  [batch] inserted={result.get('inserted', 0)} "
        f"updated={result.get('updated', 0)} "
        f"failed={len(result.get('failed', []))}"
    )
    failed_keys = {
        f.get("externalId") or f.get("name") for f in result.get("failed", [])
    }
    for celeb in batch:
        key = celeb.get("externalId") or celeb["name"]
        if key in failed_keys:
            progress["failed"].append({"key": key, "reason": "server_failed"})
        else:
            progress["done"].append(key)
    _save_progress(progress_path, progress)


def main() -> None:
    _load_dotenv(HERE / ".env.local")

    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", help="Path to manifest.json")
    parser.add_argument("--category")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--progress-file", default=".seed-progress.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    prod_url = os.environ.get("PROD_URL", "http://localhost:8788")
    admin_user = os.environ.get("ADMIN_USER", "admin")
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if not admin_password and not args.dry_run:
        sys.exit("ADMIN_PASSWORD required (or --dry-run)")

    seed_out_dir = Path(os.environ.get("SEED_OUT_DIR", "./seeds/wikidata"))
    manifest_path = Path(args.manifest) if args.manifest else seed_out_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(
            f"manifest missing: {manifest_path}\n"
            "run `pnpm --filter @starface/scripts fetch-wikidata` first"
        )

    entries: list[dict[str, Any]] = json.loads(manifest_path.read_text())
    if args.category:
        entries = [e for e in entries if e.get("category") == args.category]
    if args.limit:
        entries = entries[: args.limit]

    progress_path = Path(args.progress_file)
    progress = _load_progress(progress_path)
    done_keys = set(progress["done"])
    remaining = [e for e in entries if (e.get("wikidataId") or e["name"]) not in done_keys]

    print(
        f"[enroll] total={len(entries)} remaining={len(remaining)} "
        f"target={prod_url} embeddingDim={pipeline.EMBEDDING_DIM}"
    )

    # Warm models up-front so the first iteration doesn't stall the progress log.
    pipeline.warm()

    auth = (admin_user, admin_password)
    batch: list[dict[str, Any]] = []
    for idx, entry in enumerate(remaining, 1):
        key = entry.get("wikidataId") or entry["name"]
        photo_path = Path(entry["photoPath"])
        if not photo_path.exists():
            print(f"  [{idx}/{len(remaining)}] skip {entry['name']}: photo_missing")
            progress["failed"].append({"key": key, "reason": "photo_missing"})
            _save_progress(progress_path, progress)
            continue

        photo_bytes = photo_path.read_bytes()
        try:
            result = pipeline.process(photo_bytes)
        except pipeline.FaceEmbedError as exc:
            print(f"  [{idx}/{len(remaining)}] skip {entry['name']}: {exc.code}")
            progress["failed"].append({"key": key, "reason": exc.code})
            _save_progress(progress_path, progress)
            continue
        except Exception as exc:
            print(f"  [{idx}/{len(remaining)}] error {entry['name']}: {exc}")
            progress["failed"].append({"key": key, "reason": str(exc)[:200]})
            _save_progress(progress_path, progress)
            continue

        popularity = max(1, min(100, int(round(entry.get("sitelinks", 20) / 2))))
        batch.append(
            {
                "externalId": entry.get("wikidataId") or None,
                "name": entry["name"],
                "nameRu": entry.get("nameRu") or None,
                "category": entry.get("category"),
                "gender": result.sex,
                "age": result.age,
                "popularity": popularity,
                "descriptionEn": entry.get("descriptionEn") or None,
                "descriptionRu": entry.get("descriptionRu") or None,
                "photos": [
                    {
                        "imageBase64": base64.b64encode(photo_bytes).decode("ascii"),
                        "imageExt": _ext(entry["photoPath"]),
                        "embedding": result.embedding,
                        "detScore": result.det_score,
                        "faceQuality": result.face_quality,
                        "isPrimary": True,
                        "source": "wikidata",
                        "sourceUrl": entry.get("imageUrl"),
                    }
                ],
            }
        )
        print(
            f"  [{idx}/{len(remaining)}] ✓ {entry['name']} "
            f"(quality={result.face_quality}, det={result.det_score:.2f})"
        )

        if len(batch) >= BATCH_SIZE:
            _flush(prod_url, auth, batch, progress, progress_path, args.dry_run)
            batch = []

    if batch:
        _flush(prod_url, auth, batch, progress, progress_path, args.dry_run)

    print(
        f"[enroll] done success={len(progress['done'])} "
        f"failed={len(progress['failed'])} progress={progress_path}"
    )


if __name__ == "__main__":
    main()

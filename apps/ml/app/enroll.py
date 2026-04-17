"""Batch-enroll celebrities into Postgres.

Usage (manifest-based, recommended):
    python -m app.enroll --manifest ./seeds/celebrities.csv

Manifest CSV columns:
    name, name_ru, category, description_uz, description_ru, photo

`photo` is a path (absolute or relative to the CSV file) to a single face image.

Simple folder mode:
    python -m app.enroll --folder ./seeds/uz   # category = folder name
    # expects files named "Firstname Lastname.jpg"

Uses the local embed_image() directly — no HTTP round-trip.
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import shutil
import sys
import uuid
from pathlib import Path

import psycopg

from .embed import (
    LowQualityError,
    MultipleFacesError,
    NoFaceError,
    embed_image,
    warmup,
)

log = logging.getLogger("starface.enroll")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _photo_to_b64(path: Path) -> str:
    import base64

    return base64.b64encode(path.read_bytes()).decode("ascii")


def _copy_into_data_dir(src: Path, data_dir: Path) -> str:
    celeb_dir = data_dir / "celebrities"
    celeb_dir.mkdir(parents=True, exist_ok=True)
    ext = src.suffix.lower() or ".jpg"
    dest_name = f"{uuid.uuid4().hex}{ext}"
    dest = celeb_dir / dest_name
    shutil.copyfile(src, dest)
    return f"celebrities/{dest_name}"


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in values) + "]"


def _existing_id(conn, name: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM celebrities WHERE name = %s LIMIT 1", (name,))
        row = cur.fetchone()
    return row[0] if row else None


def _update_metadata(conn, celebrity_id: str, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE celebrities
            SET name_ru = COALESCE(NULLIF(%s, ''), name_ru),
                category = COALESCE(NULLIF(%s, ''), category),
                description_uz = COALESCE(NULLIF(%s, ''), description_uz),
                description_ru = COALESCE(NULLIF(%s, ''), description_ru),
                description_en = COALESCE(NULLIF(%s, ''), description_en),
                wikidata_id = COALESCE(NULLIF(%s, ''), wikidata_id)
            WHERE id = %s
            """,
            (
                row.get("name_ru") or "",
                row.get("category") or "",
                row.get("description_uz") or "",
                row.get("description_ru") or "",
                row.get("description_en") or "",
                row.get("wikidata_id") or "",
                celebrity_id,
            ),
        )
    conn.commit()


def _insert(conn, row: dict, embedding: list[float], photo_rel_path: str,
            face_quality: str | None = None, det_score: float | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO celebrities
                (name, name_ru, category, description_uz, description_ru, description_en, wikidata_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                row["name"],
                row.get("name_ru") or None,
                row.get("category") or None,
                row.get("description_uz") or None,
                row.get("description_ru") or None,
                row.get("description_en") or None,
                row.get("wikidata_id") or None,
            ),
        )
        celebrity_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO celebrity_photos
                (celebrity_id, photo_path, embedding, is_primary, face_quality, det_score)
            VALUES (%s, %s, %s::vector, true, %s, %s)
            """,
            (
                celebrity_id,
                photo_rel_path,
                _vector_literal(embedding),
                face_quality,
                det_score,
            ),
        )
    conn.commit()


def _iter_manifest(path: Path):
    base = path.parent
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row.get("name") or not row.get("photo"):
                continue
            photo_path = Path(row["photo"])
            if not photo_path.is_absolute():
                photo_path = (base / photo_path).resolve()
            row["_photo_path"] = photo_path
            yield row


def _iter_folder(folder: Path, category: str):
    for f in sorted(folder.iterdir()):
        if not f.is_file():
            continue
        if f.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        yield {
            "name": f.stem,
            "category": category,
            "_photo_path": f,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, help="CSV manifest file")
    parser.add_argument("--folder", type=Path, help="Folder mode: files are named as celebrity names")
    parser.add_argument("--category", type=str, default=None, help="Override category (folder mode default = folder name)")
    parser.add_argument("--database-url", type=str, default=os.getenv("DATABASE_URL"))
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("DATA_DIR", "./data")))
    args = parser.parse_args()

    if not args.database_url:
        log.error("DATABASE_URL is not set (pass --database-url or env)")
        return 2
    if not args.manifest and not args.folder:
        log.error("either --manifest or --folder must be provided")
        return 2

    log.info("warming up face model ...")
    warmup()

    if args.manifest:
        rows = list(_iter_manifest(args.manifest))
    else:
        category = args.category or args.folder.name
        rows = list(_iter_folder(args.folder, category))

    if not rows:
        log.warning("no rows to enroll")
        return 0

    total = len(rows)
    log.info("enroll: processing %d rows ...", total)
    inserted = 0
    updated = 0
    failed = 0
    with psycopg.connect(args.database_url) as conn:
        for idx, row in enumerate(rows, start=1):
            name = row.get("name") or ""
            photo_path = row["_photo_path"]

            existing = _existing_id(conn, name)
            if existing:
                _update_metadata(conn, existing, row)
                updated += 1
                if updated % 25 == 0:
                    log.info("  [%d/%d] updated %d so far", idx, total, updated)
                continue

            if not photo_path.exists():
                log.warning("  [%d/%d] missing photo: %s (%s)", idx, total, name, photo_path)
                failed += 1
                continue
            try:
                b64 = _photo_to_b64(photo_path)
                result = embed_image(b64, allow_multiple=True)
            except (NoFaceError, MultipleFacesError, LowQualityError) as e:
                log.warning("  [%d/%d] skip %s: %s", idx, total, name, e)
                failed += 1
                continue
            except Exception:
                log.exception("  [%d/%d] embed failure for %s", idx, total, name)
                failed += 1
                continue

            stored = _copy_into_data_dir(photo_path, args.data_dir)
            _insert(
                conn, row, result.embedding, stored,
                face_quality=result.face_quality,
                det_score=result.det_score,
            )
            inserted += 1
            log.info("  [%d/%d] enrolled %s (%s)", idx, total, name, row.get("category"))

    log.info("enroll done: %d inserted, %d metadata-updated, %d failed", inserted, updated, failed)
    return 0 if (inserted or updated) else 1


if __name__ == "__main__":
    sys.exit(main())

"""Back-fill face attributes (sex, age) on existing celebrities.

For each celebrity where `gender IS NULL OR age IS NULL`, loads the primary
photo from disk, runs it through InsightFace buffalo_l (the model already
loaded by the ML service), and writes `face.sex`/`face.age` back onto the
row. `attrs_source` is set to the model id for future auditability.

Cheap and idempotent — safe to re-run after each fresh import. Not wrapped
in the Playwright job queue because attribute extraction needs no scraping
(just the photo that's already on `/data/celebrities/...`).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

import psycopg

from .embed import get_face_analyzer, warmup

log = logging.getLogger("starface.attrs")

ATTRS_SOURCE = "buffalo_l"


@dataclass
class AttrsProgress:
    total: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = None  # type: ignore[assignment]

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


def _primary_photo_path(conn, celebrity_id: str) -> str | None:
    """Relative photo path of the best-ranked existing photo (is_primary
    first, else highest overall_score)."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT photo_path FROM celebrity_photos
                WHERE celebrity_id = %s
                ORDER BY is_primary DESC, overall_score DESC NULLS LAST, created_at ASC
                LIMIT 1""",
            (celebrity_id,),
        )
        row = cur.fetchone()
    return row[0] if row else None


def _extract_attrs(image_path: Path) -> tuple[str | None, int | None]:
    """Load image and return (sex, age) from the largest detected face.

    Returns (None, None) if the image is unreadable or has no face.
    """
    import cv2  # local import; cv2 is already an enrich.py dependency

    img = cv2.imread(str(image_path))
    if img is None:
        return None, None
    analyzer = get_face_analyzer()
    faces = analyzer.get(img)
    if not faces:
        return None, None
    # Pick the biggest face — enrolled photos should be single-subject but some
    # legacy seeds have crowd backgrounds.
    def _area(f) -> float:
        x1, y1, x2, y2 = f.bbox
        return max(0.0, float(x2) - float(x1)) * max(0.0, float(y2) - float(y1))

    face = max(faces, key=_area)
    sex = getattr(face, "sex", None)
    age = getattr(face, "age", None)
    sex_value = sex if sex in ("M", "F") else None
    try:
        age_value = int(age) if age is not None else None
    except (TypeError, ValueError):
        age_value = None
    return sex_value, age_value


def backfill(database_url: str, data_dir: Path, limit: int | None = None) -> AttrsProgress:
    progress = AttrsProgress()
    warmup()

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            # Only rows that actually need it; avoids re-doing work on re-runs.
            sql = """SELECT id::text, name
                       FROM celebrities
                      WHERE COALESCE(active, true)
                        AND (gender IS NULL OR age IS NULL)
                      ORDER BY created_at"""
            if limit is not None:
                sql += f" LIMIT {int(limit)}"
            cur.execute(sql)
            rows = cur.fetchall()

        progress.total = len(rows)
        for celeb_id, name in rows:
            rel = _primary_photo_path(conn, celeb_id)
            if not rel:
                progress.skipped += 1
                progress.errors.append(f"{name}: no photo")
                continue
            abs_path = data_dir / rel
            if not abs_path.exists():
                progress.skipped += 1
                progress.errors.append(f"{name}: missing file {rel}")
                continue
            try:
                sex, age = _extract_attrs(abs_path)
            except Exception as e:
                progress.skipped += 1
                progress.errors.append(f"{name}: {e}")
                continue
            if sex is None and age is None:
                progress.skipped += 1
                progress.errors.append(f"{name}: no face detected")
                continue
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE celebrities
                          SET gender = COALESCE(%s, gender),
                              age = COALESCE(%s, age),
                              attrs_source = %s
                        WHERE id = %s""",
                    (sex, age, ATTRS_SOURCE, celeb_id),
                )
            conn.commit()
            progress.updated += 1
            if progress.updated % 25 == 0:
                log.info(
                    "attrs backfill: %d/%d updated", progress.updated, progress.total
                )

    return progress


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", type=str, default=os.getenv("DATABASE_URL"))
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("DATA_DIR", "/data")))
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if not args.database_url:
        log.error("DATABASE_URL not set")
        return 2

    p = backfill(args.database_url, args.data_dir, limit=args.limit)
    log.info(
        "done: total=%d updated=%d skipped=%d errors=%d",
        p.total,
        p.updated,
        p.skipped,
        len(p.errors),
    )
    if p.errors[:5]:
        log.info("first errors: %s", p.errors[:5])
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(main())

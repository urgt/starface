"""One-shot: scan enriched celebrity_photos with OCR, drop those that carry
text overlays (news banners, video title cards, branded screenshots).
Invoke from inside the ml container: `python -m app._cleanup_text`.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

from .embed import get_face_analyzer, warmup
from .enrich import MAX_OVERLAY_TEXT_CHARS, _text_chars_outside_face


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete the flagged photos. Default is dry-run (listing only).",
    )
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 2
    data_dir = Path(os.getenv("DATA_DIR", "/data"))

    print("warming model ...")
    warmup()
    analyzer = get_face_analyzer()

    import cv2

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id::text, photo_path FROM celebrity_photos "
                "WHERE source IS NOT NULL AND is_primary = false ORDER BY created_at"
            )
            rows = cur.fetchall()

    print(f"scanning {len(rows)} enriched photos ...")
    victims: list[tuple[str, str, int]] = []
    for pid, path in rows:
        full = data_dir / path
        if not full.exists():
            continue
        img = cv2.imread(str(full))
        if img is None:
            continue
        faces = analyzer.get(img)
        if not faces:
            continue
        face = faces[0]
        try:
            chars = _text_chars_outside_face(img, tuple(face.bbox))
        except Exception as e:
            print(f"  ! OCR failed on {path}: {e}")
            continue
        if chars > MAX_OVERLAY_TEXT_CHARS:
            victims.append((pid, path, chars))
            print(f"  TEXT({chars:>3}): {path}")

    print(f"\nflagged {len(victims)} photos")
    if not victims:
        return 0
    if not args.apply:
        print("(dry-run — pass --apply to actually delete rows + files)")
        return 0

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        for pid, path, _ in victims:
            cur.execute("DELETE FROM celebrity_photos WHERE id = %s", (pid,))
            try:
                (data_dir / path).unlink()
            except Exception:
                pass
        conn.commit()

    print(f"deleted {len(victims)} rows + files")
    return 0


if __name__ == "__main__":
    sys.exit(main())

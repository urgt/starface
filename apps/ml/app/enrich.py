"""Photo enrichment agent: scrapes image-search results, scores candidates with
InsightFace + Laplacian blur, and inserts top-K into celebrity_photos.

The pipeline per celebrity:
    build_queries → Playwright search (bing/yandex) → download → score → dedup → insert

Used both from a CLI (`python -m app.enrich --celebrity-id X`) and from
the async enrich_queue.py via EnrichRunner (one Playwright browser shared
across jobs in a single worker).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import sys
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import psycopg

from .embed import get_face_analyzer, warmup

log = logging.getLogger("starface.enrich")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)

# Hard filters — candidates failing any of these are rejected outright.
MIN_FACE_SIZE = 150           # pixels, min(width, height) of face bbox
MIN_DET_SCORE = 0.6           # InsightFace detector confidence
MIN_IDENTITY_COSINE = 0.45    # cosine vs. primary embedding (same person guard)
INTRA_DUP_COSINE = 0.92       # near-duplicate of another photo of the same celeb
MAX_OVERLAY_TEXT_CHARS = 8    # reject images with more than this many OCR'd chars outside face

DEFAULT_PROVIDERS = ("bing", "yandex")
MAX_IMAGE_BYTES = 8 * 1024 * 1024

# Stock-photo / watermarked sources — filtered before download. All results from
# these CDNs carry visible watermarks and are unsuitable for training.
BLACKLISTED_HOST_SUFFIXES: tuple[str, ...] = (
    "alamy.com",
    "gettyimages.com",
    "gettyimages.co.uk",
    "gettyimages.in",
    "gettyimages.ca",
    "gettyimages.ie",
    "gettyimages.fr",
    "gettyimages.de",
    "shutterstock.com",
    "istockphoto.com",
    "depositphotos.com",
    "dreamstime.com",
    "123rf.com",
    "bigstockphoto.com",
    "stock.adobe.com",
    "adobestock.com",
    "fotolia.com",
    "stockfresh.com",
    "canstockphoto.com",
    "pond5.com",
    "vectorstock.com",
    "featurepics.com",
    "agefotostock.com",
    "imago-images.com",
    "imago-images.de",
    "picfair.com",
)

# Words in URL path that strongly correlate with watermark/preview images.
WATERMARK_URL_MARKERS: tuple[str, ...] = (
    "/watermark/",
    "/preview/",
    "/comp/",
    "/thumb/",
)


def _is_blacklisted(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return True
    host = (parsed.hostname or "").lower()
    if not host:
        return True
    for suf in BLACKLISTED_HOST_SUFFIXES:
        if host == suf or host.endswith("." + suf):
            return True
    path = (parsed.path or "").lower()
    return any(m in path for m in WATERMARK_URL_MARKERS)


# ---------------------------------------------------------------------------
# Data classes


@dataclass
class ImageCandidate:
    url: str
    provider: str
    query: str


@dataclass
class ScoredCandidate:
    url: str
    provider: str
    query: str
    local_path: Path
    embedding: np.ndarray
    det_score: float
    face_w: float
    face_h: float
    blur: float
    frontal: float
    identity: float
    overall: float


@dataclass
class EnrichProgress:
    searched: int = 0
    downloaded: int = 0
    scored: int = 0
    added: int = 0
    skipped: int = 0


@dataclass
class EnrichResult:
    celebrity_id: str
    name: str
    progress: EnrichProgress = field(default_factory=EnrichProgress)
    added_paths: list[str] = field(default_factory=list)
    error: str | None = None


ProgressFn = Callable[[EnrichProgress], None]


# ---------------------------------------------------------------------------
# Query building


def build_queries(celeb: dict) -> list[str]:
    """Generate search queries favouring real photos over paintings/illustrations."""
    name = (celeb.get("name") or "").strip()
    name_ru = (celeb.get("name_ru") or "").strip()
    queries: list[str] = []
    if name:
        queries.append(f"{name} photo")
        queries.append(f"{name} face")
    if name_ru and name_ru.lower() != name.lower():
        queries.append(f"{name_ru} фото")
        queries.append(f"{name_ru} лицо")
    # De-dup preserving order
    seen = set()
    out: list[str] = []
    for q in queries:
        if q and q not in seen:
            seen.add(q)
            out.append(q)
    return out[:4]


# ---------------------------------------------------------------------------
# Playwright search


def _search_bing(page, query: str, max_results: int) -> list[str]:
    # qft=+filterui:photo-photo restricts results to real photographs
    # (excludes clipart/line drawings/animation).
    url = (
        "https://www.bing.com/images/search?q="
        + urllib.parse.quote(query)
        + "&form=IRFLTR&qft=+filterui:photo-photo"
    )
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(800)
    for _ in range(2):
        page.evaluate("window.scrollBy(0, 1200)")
        page.wait_for_timeout(300)
    raw: list[str] = page.evaluate(
        "() => Array.from(document.querySelectorAll('a.iusc')).map(a => a.getAttribute('m')).filter(Boolean)"
    ) or []
    urls: list[str] = []
    for m in raw:
        try:
            data = json.loads(m)
        except Exception:
            continue
        u = data.get("murl") or data.get("turl")
        if u and u.startswith("http"):
            urls.append(u)
            if len(urls) >= max_results:
                break
    return urls


def _search_yandex(page, query: str, max_results: int) -> list[str]:
    # type=photo restricts to real photographs (excludes drawings/clipart).
    url = (
        "https://yandex.com/images/search?text="
        + urllib.parse.quote(query)
        + "&type=photo"
    )
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1200)
    for _ in range(2):
        page.evaluate("window.scrollBy(0, 1200)")
        page.wait_for_timeout(300)
    # Yandex wraps each result in <a href="...?img_url=ENCODED_ORIGINAL">
    hrefs: list[str] = page.evaluate(
        "() => Array.from(document.querySelectorAll('a[href*=\"img_url=\"]')).map(a => a.href)"
    ) or []
    urls: list[str] = []
    seen: set[str] = set()
    for href in hrefs:
        try:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
            img_url = qs.get("img_url", [None])[0]
        except Exception:
            continue
        if img_url and img_url not in seen and img_url.startswith("http"):
            seen.add(img_url)
            urls.append(img_url)
            if len(urls) >= max_results:
                break
    # Fallback: thumbnails
    if len(urls) < max_results // 2:
        thumbs: list[str] = page.evaluate(
            "() => Array.from(document.querySelectorAll('img.serp-item__thumb, img.MMImage-Origin')).map(i => i.src).filter(Boolean)"
        ) or []
        for u in thumbs:
            if u not in seen and u.startswith("http"):
                seen.add(u)
                urls.append(u)
                if len(urls) >= max_results:
                    break
    return urls


def search_images(
    queries: list[str],
    browser,
    providers: tuple[str, ...] = DEFAULT_PROVIDERS,
    per_query_max: int = 20,
) -> list[ImageCandidate]:
    """Run all queries × providers in a single Playwright browser, return deduped candidates."""
    context = browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 900},
        locale="en-US",
    )
    page = context.new_page()
    results: list[ImageCandidate] = []
    seen: set[str] = set()
    try:
        for query in queries:
            for provider in providers:
                try:
                    if provider == "bing":
                        urls = _search_bing(page, query, per_query_max)
                    elif provider == "yandex":
                        urls = _search_yandex(page, query, per_query_max)
                    else:
                        continue
                except Exception as e:  # one provider/query failing is non-fatal
                    log.warning("search %s/'%s' failed: %s", provider, query, e)
                    continue
                for u in urls:
                    if u in seen:
                        continue
                    seen.add(u)
                    if _is_blacklisted(u):
                        continue
                    results.append(ImageCandidate(url=u, provider=provider, query=query))
    finally:
        try:
            context.close()
        except Exception:
            pass
    return results


# ---------------------------------------------------------------------------
# Download


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def _ext_from_url(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    ext = path.rsplit(".", 1)[-1].lower()
    if ext not in {"jpg", "jpeg", "png", "webp"}:
        return "jpg"
    return ext


def download(url: str, dest_dir: Path) -> Path | None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = hashlib.sha1(url.encode("utf-8", errors="ignore")).hexdigest()[:16]
    ext = _ext_from_url(url)
    dest = dest_dir / f"{safe}.{ext}"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as r:
            ctype = (r.headers.get("Content-Type") or "").lower()
            if "image" not in ctype:
                return None
            data = r.read(MAX_IMAGE_BYTES)
        if not data:
            return None
        dest.write_bytes(data)
        return dest
    except Exception as e:
        log.debug("download failed %s: %s", url, e)
        if dest.exists():
            try:
                dest.unlink()
            except OSError:
                pass
        return None


# ---------------------------------------------------------------------------
# Scoring


def _text_chars_outside_face(img_bgr: np.ndarray, face_bbox: tuple[float, float, float, float]) -> int:
    """Max characters of confidently-OCR'd words outside the face bbox.

    Rejects news thumbnails, video title cards, and branded screenshots. Runs
    three Tesseract PSM passes over a CLAHE-enhanced copy so semi-transparent /
    low-contrast banners still register. ~600–900ms per image.
    """
    try:
        import cv2
        import pytesseract
    except Exception:
        return 0

    h, w = img_bgr.shape[:2]
    masked = img_bgr.copy()
    x1, y1, x2, y2 = [int(v) for v in face_bbox]
    pad_x = int(0.1 * max(1, x2 - x1))
    pad_y = int(0.1 * max(1, y2 - y1))
    y1c = max(0, y1 - pad_y)
    y2c = min(h, y2 + pad_y)
    x1c = max(0, x1 - pad_x)
    x2c = min(w, x2 + pad_x)
    if y2c > y1c and x2c > x1c:
        masked[y1c:y2c, x1c:x2c] = 0

    # Normalise size — tesseract struggles on both very small and very large inputs.
    longest = max(h, w)
    scale = 1000.0 / longest
    if abs(scale - 1.0) > 0.05:
        new_w = max(1, int(w * scale))
        new_h = max(1, int(h * scale))
        interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        masked = cv2.resize(masked, (new_w, new_h), interpolation=interp)

    # Contrast enhancement so pale/semi-transparent text registers.
    gray = cv2.cvtColor(masked, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)

    best_total = 0
    for psm in (11, 6, 3):
        try:
            data = pytesseract.image_to_data(
                enhanced,
                lang="eng+rus",
                output_type=pytesseract.Output.DICT,
                config=f"--psm {psm}",
                timeout=5,
            )
        except Exception as e:
            log.debug("tesseract psm=%d failed: %s", psm, e)
            continue
        words = data.get("text", []) or []
        confs = data.get("conf", []) or []
        total = 0
        for i, txt in enumerate(words):
            s = (txt or "").strip()
            if len(s) < 3:
                continue
            try:
                c = int(float(confs[i]))
            except (ValueError, TypeError, IndexError):
                c = -1
            if c >= 45:
                total += len(s)
        if total > best_total:
            best_total = total
    return best_total


def _frontal_score(face, face_w: float, face_h: float) -> float:
    """Fraction of frontality based on keypoints (0..1)."""
    kps = getattr(face, "kps", None)
    if kps is None or len(kps) < 3 or face_w <= 0 or face_h <= 0:
        return 0.5
    l_eye, r_eye, nose = kps[0], kps[1], kps[2]
    eye_mid_x = (float(l_eye[0]) + float(r_eye[0])) / 2.0
    nose_off = abs(float(nose[0]) - eye_mid_x) / face_w
    eye_tilt = abs(float(l_eye[1]) - float(r_eye[1])) / face_h
    raw = nose_off * 3.0 + eye_tilt * 4.0
    return max(0.0, min(1.0, 1.0 - raw))


def score_candidate(image_path: Path, primary_embedding: np.ndarray | None) -> ScoredCandidate | None:
    """Detect face, compute scores, apply hard filters. Returns None on reject."""
    import cv2  # local import so the module imports even without cv2 at repl time

    img = cv2.imread(str(image_path))
    if img is None:
        return None

    analyzer = get_face_analyzer()
    faces = analyzer.get(img)
    if len(faces) != 1:
        return None
    face = faces[0]

    if float(face.det_score) < MIN_DET_SCORE:
        return None

    x1, y1, x2, y2 = face.bbox
    face_w = max(0.0, float(x2) - float(x1))
    face_h = max(0.0, float(y2) - float(y1))
    if min(face_w, face_h) < MIN_FACE_SIZE:
        return None

    emb = face.normed_embedding
    if emb is None:
        return None
    emb = np.asarray(emb, dtype=np.float32)

    identity = 1.0
    if primary_embedding is not None:
        identity = float(np.dot(emb, primary_embedding))
        if identity < MIN_IDENTITY_COSINE:
            return None

    # Text-overlay guard — reject news banners, video title cards, branded screenshots.
    try:
        text_chars = _text_chars_outside_face(img, (x1, y1, x2, y2))
    except Exception:
        text_chars = 0
    if text_chars > MAX_OVERLAY_TEXT_CHARS:
        return None

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    det_norm = max(0.0, min(1.0, (float(face.det_score) - 0.5) / 0.5))
    size_norm = min(min(face_w, face_h) / 300.0, 1.0)
    frontal = _frontal_score(face, face_w, face_h)
    sharpness = min(blur_var / 300.0, 1.0)
    identity_norm = max(0.0, (identity - MIN_IDENTITY_COSINE) / (1.0 - MIN_IDENTITY_COSINE))

    overall = (
        0.35 * det_norm
        + 0.25 * size_norm
        + 0.15 * frontal
        + 0.15 * sharpness
        + 0.10 * identity_norm
    )

    return ScoredCandidate(
        url="",
        provider="",
        query="",
        local_path=image_path,
        embedding=emb,
        det_score=float(face.det_score),
        face_w=face_w,
        face_h=face_h,
        blur=blur_var,
        frontal=frontal,
        identity=identity,
        overall=overall,
    )


# ---------------------------------------------------------------------------
# DB access


def _fetch_celeb(conn, celebrity_id: str) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id::text, name, name_ru, category FROM celebrities WHERE id = %s AND COALESCE(active, true)",
            (celebrity_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "name": row[1], "name_ru": row[2], "category": row[3]}


def _parse_embedding(raw) -> np.ndarray | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            return np.asarray([float(x) for x in raw.strip("[]").split(",")], dtype=np.float32)
        except Exception:
            return None
    try:
        return np.asarray(raw, dtype=np.float32)
    except Exception:
        return None


def _fetch_primary_embedding(conn, celebrity_id: str) -> np.ndarray | None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT embedding FROM celebrity_photos
                WHERE celebrity_id = %s
                ORDER BY is_primary DESC, overall_score DESC NULLS LAST, created_at ASC
                LIMIT 1""",
            (celebrity_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _parse_embedding(row[0])


def _fetch_all_embeddings(conn, celebrity_id: str) -> list[np.ndarray]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT embedding FROM celebrity_photos WHERE celebrity_id = %s",
            (celebrity_id,),
        )
        rows = cur.fetchall()
    out: list[np.ndarray] = []
    for row in rows:
        emb = _parse_embedding(row[0])
        if emb is not None:
            out.append(emb)
    return out


def _existing_photo_count(conn, celebrity_id: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*)::int FROM celebrity_photos WHERE celebrity_id = %s",
            (celebrity_id,),
        )
        return int(cur.fetchone()[0])


def _vector_literal(values) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def _insert_photo(conn, celebrity_id: str, data_dir: Path, cand: ScoredCandidate) -> None:
    celeb_dir = data_dir / "celebrities"
    celeb_dir.mkdir(parents=True, exist_ok=True)
    ext = cand.local_path.suffix.lower() or ".jpg"
    dest_name = f"{uuid.uuid4().hex}{ext}"
    dest = celeb_dir / dest_name
    shutil.copyfile(cand.local_path, dest)
    rel_path = f"celebrities/{dest_name}"

    face_quality = (
        "high"
        if cand.det_score >= 0.75 and min(cand.face_w, cand.face_h) >= 200
        else "medium"
    )

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO celebrity_photos
                (celebrity_id, photo_path, embedding, is_primary, face_quality, det_score,
                 source, source_url, blur_score, frontal_score, overall_score)
            VALUES (%s, %s, %s::vector, false, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                celebrity_id,
                rel_path,
                _vector_literal(cand.embedding.tolist()),
                face_quality,
                cand.det_score,
                cand.provider or None,
                (cand.url or "")[:1000] or None,
                cand.blur,
                cand.frontal,
                cand.overall,
            ),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Orchestrator


def enrich_one(
    conn,
    celebrity_id: str,
    target_count: int = 8,
    data_dir: Path = Path("/data"),
    browser=None,
    on_progress: ProgressFn | None = None,
    providers: tuple[str, ...] = DEFAULT_PROVIDERS,
) -> EnrichResult:
    """Run full enrichment for a single celebrity. `browser` is optional —
    if None, a short-lived Playwright browser is launched for this call."""
    celeb = _fetch_celeb(conn, celebrity_id)
    if not celeb:
        return EnrichResult(celebrity_id=celebrity_id, name="", error="celebrity not found")

    name = celeb["name"] or ""
    result = EnrichResult(celebrity_id=celebrity_id, name=name)

    existing = _existing_photo_count(conn, celebrity_id)
    need = max(0, target_count - existing)
    if need == 0:
        return result

    queries = build_queries(celeb)
    if not queries:
        result.error = "no query (empty name)"
        return result

    primary = _fetch_primary_embedding(conn, celebrity_id)
    existing_embs = _fetch_all_embeddings(conn, celebrity_id)

    per_query_max = max(15, need * 4)

    def _do_search(b) -> list[ImageCandidate]:
        return search_images(queries, b, providers=providers, per_query_max=per_query_max)

    if browser is None:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            try:
                candidates = _do_search(b)
            finally:
                b.close()
    else:
        candidates = _do_search(browser)

    result.progress.searched = len(candidates)
    if on_progress:
        on_progress(result.progress)

    dl_dir = data_dir / "seeds" / "enrich" / celebrity_id
    scored: list[ScoredCandidate] = []
    max_to_process = need * 10 + 20
    for idx, cand in enumerate(candidates[:max_to_process]):
        local = download(cand.url, dl_dir)
        if not local:
            continue
        result.progress.downloaded += 1
        try:
            sc = score_candidate(local, primary)
        except Exception as e:
            log.debug("score failed %s: %s", local, e)
            sc = None
        if sc is None:
            result.progress.skipped += 1
            _safe_unlink(local)  # didn't pass filters — drop immediately
        else:
            sc.url = cand.url
            sc.provider = cand.provider
            sc.query = cand.query
            scored.append(sc)
            result.progress.scored += 1
        if on_progress and idx % 3 == 0:
            on_progress(result.progress)
        if len(scored) >= need * 3:
            break

    # Select top-K with intra-deduplication against existing + already-selected.
    chosen_embs = list(existing_embs)
    selected: list[ScoredCandidate] = []
    rejected_by_dedup: list[ScoredCandidate] = []
    for sc in sorted(scored, key=lambda s: s.overall, reverse=True):
        dup = any(float(np.dot(sc.embedding, e)) > INTRA_DUP_COSINE for e in chosen_embs)
        if dup:
            result.progress.skipped += 1
            rejected_by_dedup.append(sc)
            continue
        if len(selected) >= need:
            rejected_by_dedup.append(sc)
            continue
        selected.append(sc)
        chosen_embs.append(sc.embedding)

    # Scored-but-not-selected (near-duplicates / tail of the ranked list) → drop.
    for sc in rejected_by_dedup:
        _safe_unlink(sc.local_path)

    for sc in selected:
        try:
            _insert_photo(conn, celebrity_id, data_dir, sc)
            result.added_paths.append(sc.local_path.name)
            result.progress.added += 1
        except Exception as e:
            log.exception("insert photo failed for %s: %s", name, e)
            result.progress.skipped += 1
        finally:
            # The insert copied the file into /data/celebrities/{uuid}.ext;
            # the cached download is no longer needed.
            _safe_unlink(sc.local_path)

    # Best-effort: remove the celebrity-specific cache dir if empty.
    try:
        dl_dir.rmdir()
    except OSError:
        pass

    if on_progress:
        on_progress(result.progress)
    return result


def select_missing_celebrities(conn, target_count: int) -> list[tuple[str, str]]:
    """Return [(id, name), ...] of active celebrities with fewer than target photos."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT c.id::text, c.name
                 FROM celebrities c
                 LEFT JOIN (
                     SELECT celebrity_id, COUNT(*) n
                       FROM celebrity_photos
                      GROUP BY celebrity_id
                 ) cp ON cp.celebrity_id = c.id
                WHERE COALESCE(c.active, true) AND COALESCE(cp.n, 0) < %s
                ORDER BY c.created_at""",
            (target_count,),
        )
        return list(cur.fetchall())


# ---------------------------------------------------------------------------
# CLI


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--celebrity-id", type=str)
    parser.add_argument("--only-missing", action="store_true")
    parser.add_argument("--target-count", type=int, default=8)
    parser.add_argument("--database-url", type=str, default=os.getenv("DATABASE_URL"))
    parser.add_argument("--data-dir", type=Path, default=Path(os.getenv("DATA_DIR", "/data")))
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if not args.database_url:
        log.error("DATABASE_URL not set (pass --database-url or env)")
        return 2

    log.info("warming up face model ...")
    warmup()

    ids: list[str] = []
    with psycopg.connect(args.database_url) as conn:
        if args.celebrity_id:
            ids = [args.celebrity_id]
        elif args.only_missing:
            ids = [cid for cid, _ in select_missing_celebrities(conn, args.target_count)]
        else:
            log.error("pass --celebrity-id <uuid> or --only-missing")
            return 2

    if not ids:
        log.warning("no celebrities matched — nothing to do")
        return 0

    log.info("enrich: %d celebrities, target=%d", len(ids), args.target_count)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            with psycopg.connect(args.database_url) as conn:
                for i, cid in enumerate(ids, start=1):
                    log.info("[%d/%d] enrich %s", i, len(ids), cid)
                    res = enrich_one(
                        conn,
                        cid,
                        target_count=args.target_count,
                        data_dir=args.data_dir,
                        browser=browser,
                    )
                    log.info(
                        "  %s: searched=%d downloaded=%d scored=%d added=%d skipped=%d err=%s",
                        res.name,
                        res.progress.searched,
                        res.progress.downloaded,
                        res.progress.scored,
                        res.progress.added,
                        res.progress.skipped,
                        res.error,
                    )
        finally:
            browser.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())

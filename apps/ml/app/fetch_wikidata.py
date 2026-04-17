"""Fetch celebrity portraits from Wikidata + Wikimedia Commons.

Produces a manifest CSV consumable by enroll.py. Categories:
  uz    — people born in / citizens of Uzbekistan
  cis   — Russia, Ukraine, Belarus, Kazakhstan, Kyrgyzstan, Tajikistan,
          Azerbaijan, Armenia, Moldova, Turkmenistan
  world — globally famous actors / musicians (ranked by sitelinks)

Usage:
    python -m app.fetch_wikidata --category all
    python -m app.fetch_wikidata --category world --limit 500

Resumable: skips photos already downloaded. Safe to re-run.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

SPARQL_URL = "https://query.wikidata.org/sparql"
USER_AGENT = "StarFaceUZ/0.1 (https://github.com/; contact@starface.uz)"

log = logging.getLogger("fetch_wikidata")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# Query templates — {limit} substituted at runtime. UZ label we take from English
# (most Uzbek figures on Wikidata have an English label; native-uz labels are rare).
QUERIES: dict[str, str] = {
    "uz": """
SELECT DISTINCT ?person ?personLabel ?personLabelRu ?descEn ?descRu ?image ?sitelinks WHERE {
  ?person wdt:P31 wd:Q5 ;
          wdt:P27 wd:Q265 ;
          wdt:P18 ?image ;
          wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?person rdfs:label ?personLabelRu . FILTER(LANG(?personLabelRu) = "ru") }
  OPTIONAL { ?person schema:description ?descEn . FILTER(LANG(?descEn) = "en") }
  OPTIONAL { ?person schema:description ?descRu . FILTER(LANG(?descRu) = "ru") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . ?person rdfs:label ?personLabel . }
}
ORDER BY DESC(?sitelinks)
LIMIT {limit}
""",
    "cis": """
SELECT DISTINCT ?person ?personLabel ?personLabelRu ?descEn ?descRu ?image ?sitelinks WHERE {
  VALUES ?country {
    wd:Q159  # Russia
    wd:Q212  # Ukraine
    wd:Q184  # Belarus
    wd:Q232  # Kazakhstan
    wd:Q813  # Kyrgyzstan
    wd:Q863  # Tajikistan
    wd:Q227  # Azerbaijan
    wd:Q399  # Armenia
    wd:Q217  # Moldova
    wd:Q874  # Turkmenistan
  }
  ?person wdt:P31 wd:Q5 ;
          wdt:P27 ?country ;
          wdt:P18 ?image ;
          wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks > 20)
  OPTIONAL { ?person rdfs:label ?personLabelRu . FILTER(LANG(?personLabelRu) = "ru") }
  OPTIONAL { ?person schema:description ?descEn . FILTER(LANG(?descEn) = "en") }
  OPTIONAL { ?person schema:description ?descRu . FILTER(LANG(?descRu) = "ru") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . ?person rdfs:label ?personLabel . }
}
ORDER BY DESC(?sitelinks)
LIMIT {limit}
""",
    "world": """
SELECT DISTINCT ?person ?personLabel ?personLabelRu ?descEn ?descRu ?image ?sitelinks WHERE {
  ?person wdt:P31 wd:Q5 ;
          wdt:P18 ?image ;
          wikibase:sitelinks ?sitelinks .
  VALUES ?occ {
    wd:Q33999     # actor
    wd:Q10800557  # film actor
    wd:Q10798782  # television actor
    wd:Q177220    # singer
    wd:Q639669    # musician
    wd:Q937857    # association football player
  }
  ?person wdt:P106 ?occ .
  FILTER(?sitelinks > 50)
  OPTIONAL { ?person rdfs:label ?personLabelRu . FILTER(LANG(?personLabelRu) = "ru") }
  OPTIONAL { ?person schema:description ?descEn . FILTER(LANG(?descEn) = "en") }
  OPTIONAL { ?person schema:description ?descRu . FILTER(LANG(?descRu) = "ru") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . ?person rdfs:label ?personLabel . }
}
ORDER BY DESC(?sitelinks)
LIMIT {limit}
""",
}


def sparql(query: str, retries: int = 3) -> list[dict]:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            data = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
            req = urllib.request.Request(
                SPARQL_URL,
                data=data,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "application/sparql-results+json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as r:
                parsed = json.load(r)
            return parsed["results"]["bindings"]
        except Exception as e:
            last_err = e
            log.warning("sparql attempt %d failed: %s", attempt + 1, e)
            time.sleep(3 * (attempt + 1))
    assert last_err is not None
    raise last_err


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.write_bytes(r.read())


def _ext_from_url(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    ext = path.rsplit(".", 1)[-1].lower()
    if ext not in {"jpg", "jpeg", "png", "webp"}:
        return "jpg"
    return ext


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", choices=["uz", "cis", "world", "all"], default="all")
    parser.add_argument("--limit", type=int, default=None, help="Override per-category limit")
    parser.add_argument("--limit-uz", type=int, default=300)
    parser.add_argument("--limit-cis", type=int, default=700)
    parser.add_argument("--limit-world", type=int, default=1500)
    parser.add_argument("--out-dir", type=Path, default=Path("seeds/wikidata"))
    parser.add_argument("--sleep", type=float, default=0.15, help="Seconds between image downloads")
    args = parser.parse_args()

    out_dir = args.out_dir.resolve()
    photos_dir = out_dir / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "celebrities.csv"

    cats = ["uz", "cis", "world"] if args.category == "all" else [args.category]
    limits = {
        "uz": args.limit or args.limit_uz,
        "cis": args.limit or args.limit_cis,
        "world": args.limit or args.limit_world,
    }

    # Rebuild CSV from scratch each run so SPARQL-refreshed descriptions land.
    # Photo downloads remain idempotent via dest.exists() check below.
    rows: list[dict] = []
    ok = 0
    failed = 0

    for cat in cats:
        query = QUERIES[cat].replace("{limit}", str(limits[cat]))
        log.info("fetching category=%s limit=%d ...", cat, limits[cat])
        bindings = sparql(query)
        total_for_cat = len(bindings)
        log.info("  got %d entries for %s — downloading photos ...", total_for_cat, cat)
        cat_ok = 0
        cat_cached = 0
        cat_failed = 0

        for idx, b in enumerate(bindings, start=1):
            name = b.get("personLabel", {}).get("value", "").strip()
            name_ru = b.get("personLabelRu", {}).get("value", "").strip()
            desc_en = b.get("descEn", {}).get("value", "").strip()
            desc_ru = b.get("descRu", {}).get("value", "").strip()
            image_url = b.get("image", {}).get("value", "")
            person_url = b.get("person", {}).get("value", "")
            wikidata_id = person_url.rsplit("/", 1)[-1] if person_url else ""
            if not name or name.startswith("Q") or not image_url:
                continue

            row = {
                "name": name,
                "name_ru": name_ru,
                "category": cat,
                "description_uz": "",        # filled later by LM Studio generator
                "description_ru": desc_ru,
                "description_en": desc_en,
                "wikidata_id": wikidata_id,
            }

            safe = hashlib.sha1(image_url.encode()).hexdigest()[:16]
            ext = _ext_from_url(image_url)
            filename = f"{cat}-{safe}.{ext}"
            dest = photos_dir / filename

            if dest.exists():
                rows.append({**row, "photo": str(dest)})
                ok += 1
                cat_cached += 1
                continue

            try:
                download(image_url, dest)
                rows.append({**row, "photo": str(dest)})
                ok += 1
                cat_ok += 1
                log.info("  [%d/%d] %s ← %s", idx, total_for_cat, cat, name)
                time.sleep(args.sleep)
            except Exception as e:
                log.warning("  [%d/%d] %s download failed: %s — %s", idx, total_for_cat, cat, name, e)
                failed += 1
                cat_failed += 1

            # periodic manifest flush so a crash doesn't lose progress
            if ok % 50 == 0:
                _write_manifest(manifest_path, rows)

        log.info(
            "  category=%s done: %d new, %d cached, %d failed",
            cat, cat_ok, cat_cached, cat_failed,
        )

    _write_manifest(manifest_path, rows)
    log.info("done: %d ok, %d failed. manifest: %s", ok, failed, manifest_path)
    log.info("next: python -m app.enroll --manifest %s", manifest_path)
    return 0


def _write_manifest(path: Path, rows: list[dict]) -> None:
    # De-duplicate by (photo) path
    seen: set[str] = set()
    unique: list[dict] = []
    for r in rows:
        key = r.get("photo", "")
        if key and key not in seen:
            seen.add(key)
            unique.append(r)
    fields = ["name", "name_ru", "category", "description_uz", "description_ru", "description_en", "wikidata_id", "photo"]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for r in unique:
            writer.writerow({k: r.get(k, "") for k in fields})


if __name__ == "__main__":
    sys.exit(main())

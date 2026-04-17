"""Populate celebrities.popularity from Wikipedia pageviews.

For each celebrity with a wikidata_id, resolves Wikipedia article titles
(en/ru/uz) via the Wikidata entity JSON, then sums monthly pageviews from
the Wikimedia REST pageviews API for the last complete calendar month.
Writes the total into celebrities.popularity.

Usage:
    python -m app.fetch_popularity
    python -m app.fetch_popularity --limit 200
    python -m app.fetch_popularity --sleep-ms 120

Idempotent. Safe to re-run. Expected cadence: monthly.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys
import time
import urllib.parse
import urllib.request
from typing import Iterable

import psycopg

USER_AGENT = "StarFaceUZ/1.0 (https://starface.uz; contact@starface.uz)"
WIKIS = ("enwiki", "ruwiki", "uzwiki")
PROJECTS = {
    "enwiki": "en.wikipedia",
    "ruwiki": "ru.wikipedia",
    "uzwiki": "uz.wikipedia",
}

log = logging.getLogger("fetch_popularity")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def http_get_json(url: str, *, timeout: int = 20) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        log.warning("http %s %s", e.code, url)
        return None
    except Exception as e:
        log.warning("http error %s: %s", url, e)
        return None


def last_full_month_range(today: dt.date | None = None) -> tuple[str, str]:
    today = today or dt.date.today()
    first_this = today.replace(day=1)
    last_prev = first_this - dt.timedelta(days=1)
    first_prev = last_prev.replace(day=1)
    return first_prev.strftime("%Y%m%d00"), last_prev.strftime("%Y%m%d00")


def resolve_titles(qid: str) -> dict[str, str]:
    """Return {'enwiki': 'Brad_Pitt', ...} for each found wiki."""
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    data = http_get_json(url)
    if not data:
        return {}
    entities = data.get("entities", {})
    entity = entities.get(qid)
    if not entity:
        return {}
    sitelinks = entity.get("sitelinks", {})
    titles: dict[str, str] = {}
    for wiki in WIKIS:
        link = sitelinks.get(wiki)
        if link and link.get("title"):
            # Wikimedia pageviews API expects underscores for spaces
            titles[wiki] = link["title"].replace(" ", "_")
    return titles


def pageviews_month(project: str, title: str, start: str, end: str) -> int:
    encoded = urllib.parse.quote(title, safe="")
    url = (
        f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
        f"{project}/all-access/user/{encoded}/monthly/{start}/{end}"
    )
    data = http_get_json(url)
    if not data or "items" not in data:
        return 0
    return sum(int(it.get("views", 0)) for it in data["items"])


def popularity_for(qid: str, start: str, end: str, sleep_s: float) -> int:
    titles = resolve_titles(qid)
    if not titles:
        return 0
    total = 0
    for wiki, title in titles.items():
        project = PROJECTS[wiki]
        time.sleep(sleep_s)
        total += pageviews_month(project, title, start, end)
    return total


def iter_candidates(conn: psycopg.Connection, limit: int | None) -> Iterable[tuple[str, str, str]]:
    q = (
        "SELECT id::text, name, wikidata_id FROM celebrities "
        "WHERE wikidata_id IS NOT NULL AND active = true "
        "ORDER BY popularity ASC, created_at ASC"
    )
    if limit:
        q += f" LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(q)
        for row in cur:
            yield row  # type: ignore[misc]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None, help="Max celebrities to process")
    parser.add_argument(
        "--sleep-ms",
        type=int,
        default=120,
        help="Delay between API calls (ms). Be gentle to Wikimedia.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute but don't write to DB",
    )
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        log.error("DATABASE_URL is not set")
        return 1

    start, end = last_full_month_range()
    log.info("Pageviews window: %s … %s", start, end)
    sleep_s = max(0, args.sleep_ms) / 1000.0

    updated = 0
    skipped = 0
    with psycopg.connect(database_url, autocommit=False) as conn:
        rows = list(iter_candidates(conn, args.limit))
        log.info("Candidates: %d", len(rows))
        for idx, (cid, name, qid) in enumerate(rows, 1):
            try:
                score = popularity_for(qid, start, end, sleep_s)
            except Exception as e:
                log.warning("[%d/%d] %s (%s): error %s", idx, len(rows), name, qid, e)
                skipped += 1
                continue

            log.info("[%d/%d] %s (%s): %d views", idx, len(rows), name, qid, score)
            if args.dry_run:
                continue

            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE celebrities SET popularity = %s WHERE id = %s",
                    (score, cid),
                )
            conn.commit()
            updated += 1

    log.info("Done. updated=%d skipped=%d", updated, skipped)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Generate rich UZ/RU/EN biographical descriptions for celebrities.

For each celebrity it:
  1. Resolves Wikipedia article titles via Wikidata sitelinks (uses wikidata_id).
  2. Fetches the Wikipedia intro paragraph(s) in en/ru/uz (whichever exist).
  3. Asks LM Studio (OpenAI-compatible) for three short descriptions (uz, ru, en)
     grounded in the Wikipedia text.
  4. Writes all three to the celebrities table.

Usage:
    python -m app.generate_descriptions                     # rows missing any lang
    python -m app.generate_descriptions --limit 20
    python -m app.generate_descriptions --force             # regenerate everything

Environment:
    LM_BASE_URL   default http://192.168.100.3:1234/v1
    LM_API_KEY    default lmstudio
    LM_MODEL      default gemma-4-26b-a4b-it
    DATABASE_URL  required
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

import psycopg

log = logging.getLogger("generate_descriptions")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

USER_AGENT = "StarFaceUZ/0.1 (https://github.com/; contact@starface.uz)"


@dataclass
class Settings:
    base_url: str
    api_key: str
    model: str
    max_tokens: int = 1500
    temperature: float = 0.3
    timeout: int = 180


def settings_from_env() -> Settings:
    return Settings(
        base_url=os.getenv("LM_BASE_URL", "http://127.0.0.1:1234/v1"),
        api_key=os.getenv("LM_API_KEY", "lmstudio"),
        model=os.getenv("LM_MODEL", "google/gemma-4-e4b"),
    )


def settings_from_db(database_url: str) -> Settings | None:
    """Read llm.* keys from app_settings. Returns None if table is empty/missing."""
    try:
        with psycopg.connect(database_url) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT key, value FROM app_settings WHERE key IN ('llm.base_url','llm.api_key','llm.model')"
            )
            rows = cur.fetchall()
    except Exception as e:
        log.warning("cannot read app_settings: %s", e)
        return None

    values = {k: v for k, v in rows if v}
    if not values:
        return None

    env = settings_from_env()
    return Settings(
        base_url=values.get("llm.base_url", env.base_url),
        api_key=values.get("llm.api_key", env.api_key),
        model=values.get("llm.model", env.model),
    )


def resolve_settings(database_url: str) -> Settings:
    """Prefer DB app_settings, fall back to env."""
    db_settings = settings_from_db(database_url)
    return db_settings or settings_from_env()


# ---------------------------------------------------------------------------
# Wikipedia helpers


def _get_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def wikidata_sitelinks(qid: str) -> dict[str, str]:
    """Return {'enwiki': 'Title', 'ruwiki': 'Title', 'uzwiki': 'Title'} (subset)."""
    url = (
        "https://www.wikidata.org/w/api.php?action=wbgetentities"
        f"&ids={qid}&props=sitelinks&sitefilter=enwiki|ruwiki|uzwiki&format=json"
    )
    try:
        data = _get_json(url)
    except Exception as e:
        log.warning("sitelinks fetch failed for %s: %s", qid, e)
        return {}
    entity = data.get("entities", {}).get(qid) or {}
    sitelinks = entity.get("sitelinks", {}) or {}
    return {k: v.get("title") for k, v in sitelinks.items() if v.get("title")}


def wikipedia_extract(lang: str, title: str) -> str:
    """Fetch plain-text intro paragraph(s) from Wikipedia REST API."""
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{encoded}"
    try:
        data = _get_json(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return ""
        log.warning("wiki %s/%s HTTP %d", lang, title, e.code)
        return ""
    except Exception as e:
        log.warning("wiki %s/%s failed: %s", lang, title, e)
        return ""
    return (data.get("extract") or "").strip()


# ---------------------------------------------------------------------------
# LM Studio client


def _chat_json(settings: Settings, system: str, user: str) -> dict:
    url = settings.base_url.rstrip("/") + "/chat/completions"
    body = json.dumps(
        {
            "model": settings.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=settings.timeout) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from e
    content = data["choices"][0]["message"]["content"]
    return _parse_json(content)


def _parse_json(text: str) -> dict:
    text = text.strip()
    # strip markdown fences if present
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    text = text.strip()
    # try direct parse, else find first {...}
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            return json.loads(m.group(0))
        raise


SYSTEM_PROMPT = """You are a concise bilingual biography writer.

Given a person's name and Wikipedia excerpts, produce short, informative biographical descriptions in three languages: Uzbek (Latin script), Russian, and English.

Rules for every description:
- 200-350 characters, 1-3 sentences, natural for the language
- State the person's main claim to fame: profession, nationality, era, headline achievements
- Include concrete facts ONLY if they appear in the provided Wikipedia text (years, titles, championships, films, etc.)
- Do not invent, speculate, or add facts not in the source
- Write in the target language natively (no transliteration)
- Uzbek must be Latin script (o‘zbekcha, lotin yozuvida)

Respond with a single JSON object:
{"uz": "...", "ru": "...", "en": "..."}

Output ONLY the JSON, no commentary, no markdown fences."""


def build_user_prompt(
    name: str,
    name_ru: str,
    category: str,
    wiki_en: str,
    wiki_ru: str,
    wiki_uz: str,
    short_en: str,
    short_ru: str,
) -> str:
    lines = [f"Person: {name}"]
    if name_ru:
        lines.append(f"Russian name: {name_ru}")
    if category:
        lines.append(f"Category hint: {category}")

    if wiki_en:
        lines.append("\nWikipedia (English):")
        lines.append(wiki_en[:1800])
    if wiki_ru:
        lines.append("\nWikipedia (Russian):")
        lines.append(wiki_ru[:1800])
    if wiki_uz:
        lines.append("\nWikipedia (Uzbek):")
        lines.append(wiki_uz[:1800])

    if not (wiki_en or wiki_ru or wiki_uz):
        if short_en:
            lines.append(f"\nShort (en): {short_en}")
        if short_ru:
            lines.append(f"\nShort (ru): {short_ru}")

    lines.append("\nGenerate the JSON now.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DB


def _fetch_rows(conn, where: str, limit: int | None):
    sql = f"""
        SELECT id, name, COALESCE(name_ru,''), COALESCE(category,''),
               COALESCE(description_en,''), COALESCE(description_ru,''),
               COALESCE(wikidata_id,'')
        FROM celebrities
        WHERE {where}
        ORDER BY created_at
    """
    if limit:
        sql += f"\n        LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def _update(conn, cid: str, uz: str, ru: str, en: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE celebrities
               SET description_uz = COALESCE(NULLIF(%s,''), description_uz),
                   description_ru = COALESCE(NULLIF(%s,''), description_ru),
                   description_en = COALESCE(NULLIF(%s,''), description_en)
               WHERE id = %s""",
            (uz, ru, en, cid),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Reusable one-shot processor used by the async job queue.

def process_one(conn, celebrity_id: str, settings: Settings) -> dict:
    """Generate UZ/RU/EN descriptions for one celebrity. Updates DB.

    Raises on empty LM response or missing celebrity. Returns dict with
    ``name, uz, ru, en, sources``.
    """
    with conn.cursor() as cur:
        cur.execute(
            """SELECT name, COALESCE(name_ru,''), COALESCE(category,''),
                      COALESCE(description_en,''), COALESCE(description_ru,''),
                      COALESCE(wikidata_id,'')
                 FROM celebrities WHERE id = %s""",
            (celebrity_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ValueError("celebrity_not_found")

    name, name_ru, category, desc_en, desc_ru, qid = row

    wiki_en = wiki_ru = wiki_uz = ""
    if qid:
        sitelinks = wikidata_sitelinks(qid)
        if sitelinks.get("enwiki"):
            wiki_en = wikipedia_extract("en", sitelinks["enwiki"])
        if sitelinks.get("ruwiki"):
            wiki_ru = wikipedia_extract("ru", sitelinks["ruwiki"])
        if sitelinks.get("uzwiki"):
            wiki_uz = wikipedia_extract("uz", sitelinks["uzwiki"])

    prompt = build_user_prompt(name, name_ru, category, wiki_en, wiki_ru, wiki_uz, desc_en, desc_ru)
    result = _chat_json(settings, SYSTEM_PROMPT, prompt)
    uz = (result.get("uz") or "").strip()
    ru = (result.get("ru") or "").strip()
    en = (result.get("en") or "").strip()
    if not (uz or ru or en):
        raise ValueError("empty_lm_response")

    _update(conn, celebrity_id, uz, ru, en)

    sources = []
    if wiki_en:
        sources.append("en-wiki")
    if wiki_ru:
        sources.append("ru-wiki")
    if wiki_uz:
        sources.append("uz-wiki")
    return {"name": name, "uz": uz, "ru": ru, "en": en, "sources": sources}


# ---------------------------------------------------------------------------
# Main


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="regenerate even if descriptions exist")
    parser.add_argument("--sleep", type=float, default=0.3)
    args = parser.parse_args()

    if not args.database_url:
        log.error("DATABASE_URL is required")
        return 2

    settings = resolve_settings(args.database_url)
    log.info("LM: %s  model=%s", settings.base_url, settings.model)

    if args.force:
        where = "TRUE"
    else:
        where = (
            "(description_uz IS NULL OR description_uz='' "
            "OR description_ru IS NULL OR description_ru='' "
            "OR description_en IS NULL OR description_en='')"
        )

    ok = 0
    failed = 0
    with psycopg.connect(args.database_url) as conn:
        rows = _fetch_rows(conn, where, args.limit)
        total = len(rows)
        log.info("candidates: %d", total)

        for idx, (cid, name, name_ru, category, desc_en, desc_ru, qid) in enumerate(rows, start=1):
            wiki_en = wiki_ru = wiki_uz = ""
            if qid:
                sitelinks = wikidata_sitelinks(qid)
                if sitelinks.get("enwiki"):
                    wiki_en = wikipedia_extract("en", sitelinks["enwiki"])
                if sitelinks.get("ruwiki"):
                    wiki_ru = wikipedia_extract("ru", sitelinks["ruwiki"])
                if sitelinks.get("uzwiki"):
                    wiki_uz = wikipedia_extract("uz", sitelinks["uzwiki"])

            prompt = build_user_prompt(
                name, name_ru, category, wiki_en, wiki_ru, wiki_uz, desc_en, desc_ru
            )

            try:
                result = _chat_json(settings, SYSTEM_PROMPT, prompt)
            except Exception as e:
                log.warning("  [%d/%d] LM failed for %s: %s", idx, total, name, e)
                failed += 1
                time.sleep(1.0)
                continue

            uz = (result.get("uz") or "").strip()
            ru = (result.get("ru") or "").strip()
            en = (result.get("en") or "").strip()
            if not (uz or ru or en):
                log.warning("  [%d/%d] empty LM response for %s: %r", idx, total, name, result)
                failed += 1
                continue

            _update(conn, cid, uz, ru, en)
            ok += 1
            source = []
            if wiki_en: source.append("en-wiki")
            if wiki_ru: source.append("ru-wiki")
            if wiki_uz: source.append("uz-wiki")
            log.info(
                "  [%d/%d] ✓ %s [%s] uz=%s",
                idx, total, name,
                ",".join(source) or "no-wiki",
                uz[:60] + ("..." if len(uz) > 60 else ""),
            )
            time.sleep(args.sleep)

    log.info("done: %d ok, %d failed", ok, failed)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

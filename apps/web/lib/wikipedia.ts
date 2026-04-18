import type { Language } from "./llm/schema";

const FETCH_TIMEOUT_MS = 4000;

const wikidataEntityUrl = (id: string) =>
  `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(id)}.json?props=sitelinks`;

const wikipediaSummaryUrl = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

type SitelinkMap = Record<string, { title?: string } | undefined>;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "starface-admin/1.0 (dataset enrichment)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getSitelinks(wikidataId: string): Promise<SitelinkMap> {
  try {
    const res = await fetchWithTimeout(wikidataEntityUrl(wikidataId));
    if (!res.ok) return {};
    const data = (await res.json()) as {
      entities?: Record<string, { sitelinks?: SitelinkMap }>;
    };
    return data.entities?.[wikidataId]?.sitelinks ?? {};
  } catch {
    return {};
  }
}

async function fetchSummary(lang: string, title: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(wikipediaSummaryUrl(lang, title));
    if (!res.ok) return null;
    const data = (await res.json()) as { extract?: string };
    return data.extract ?? null;
  } catch {
    return null;
  }
}

export type WikipediaSummaries = {
  uz: string | null;
  ru: string | null;
  en: string | null;
};

export async function fetchSummaries(
  wikidataId: string,
  langs: Language[],
): Promise<WikipediaSummaries> {
  const out: WikipediaSummaries = { uz: null, ru: null, en: null };
  const sitelinks = await getSitelinks(wikidataId);
  await Promise.all(
    langs.map(async (lang) => {
      const title = sitelinks[`${lang}wiki`]?.title;
      if (!title) return;
      out[lang] = await fetchSummary(lang, title);
    }),
  );
  return out;
}

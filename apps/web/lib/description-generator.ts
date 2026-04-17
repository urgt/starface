import { getLlmConfig, type LlmConfig } from "./settings";

const USER_AGENT = "StarFaceUZ/0.1 (https://github.com/; contact@starface.uz)";

export type CelebrityInput = {
  name: string;
  nameRu?: string | null;
  category?: string | null;
  descriptionRu?: string | null;
  descriptionEn?: string | null;
  wikidataId?: string | null;
};

export type GeneratedDescriptions = {
  uz: string;
  ru: string;
  en: string;
  sources: string[];
};

const SYSTEM_PROMPT = `You are a concise bilingual biography writer.

Given a person's name and Wikipedia excerpts, produce short, informative biographical descriptions in three languages: Uzbek (Latin script), Russian, and English.

Rules for every description:
- 200-350 characters, 1-3 sentences, natural for the language
- State the person's main claim to fame: profession, nationality, era, headline achievements
- Include concrete facts ONLY if they appear in the provided Wikipedia text (years, titles, championships, films, etc.)
- Do not invent, speculate, or add facts not in the source
- Write in the target language natively (no transliteration)
- Uzbek must be Latin script (o'zbekcha, lotin yozuvida)

Respond with a single JSON object:
{"uz": "...", "ru": "...", "en": "..."}

Output ONLY the JSON, no commentary, no markdown fences.`;

async function getJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

type WikidataEntitiesResponse = {
  entities: Record<string, { sitelinks?: Record<string, { title?: string }> }>;
};

export async function fetchWikidataSitelinks(
  qid: string,
): Promise<{ enwiki?: string; ruwiki?: string; uzwiki?: string }> {
  if (!qid) return {};
  const url =
    "https://www.wikidata.org/w/api.php?action=wbgetentities" +
    `&ids=${encodeURIComponent(qid)}&props=sitelinks&sitefilter=enwiki|ruwiki|uzwiki&format=json`;
  try {
    const data = await getJson<WikidataEntitiesResponse>(url);
    const entity = data.entities?.[qid];
    const sl = entity?.sitelinks ?? {};
    return {
      enwiki: sl.enwiki?.title,
      ruwiki: sl.ruwiki?.title,
      uzwiki: sl.uzwiki?.title,
    };
  } catch {
    return {};
  }
}

type WikipediaSummaryResponse = { extract?: string };

export async function fetchWikipediaExtract(lang: string, title: string): Promise<string> {
  if (!title) return "";
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  try {
    const data = await getJson<WikipediaSummaryResponse>(url);
    return (data.extract ?? "").trim();
  } catch {
    return "";
  }
}

function parseJsonLoose(text: string): Record<string, string> {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.split("```", 3)[1] ?? s;
    if (s.startsWith("json")) s = s.slice(4);
  }
  s = s.trim();
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    const match = s.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as Record<string, string>;
    throw new Error("failed to parse LLM JSON response");
  }
}

function buildUserPrompt(
  celeb: CelebrityInput,
  wikiEn: string,
  wikiRu: string,
  wikiUz: string,
): string {
  const lines = [`Person: ${celeb.name}`];
  if (celeb.nameRu) lines.push(`Russian name: ${celeb.nameRu}`);
  if (celeb.category) lines.push(`Category hint: ${celeb.category}`);

  if (wikiEn) {
    lines.push("\nWikipedia (English):");
    lines.push(wikiEn.slice(0, 1800));
  }
  if (wikiRu) {
    lines.push("\nWikipedia (Russian):");
    lines.push(wikiRu.slice(0, 1800));
  }
  if (wikiUz) {
    lines.push("\nWikipedia (Uzbek):");
    lines.push(wikiUz.slice(0, 1800));
  }
  if (!wikiEn && !wikiRu && !wikiUz) {
    if (celeb.descriptionEn) lines.push(`\nShort (en): ${celeb.descriptionEn}`);
    if (celeb.descriptionRu) lines.push(`\nShort (ru): ${celeb.descriptionRu}`);
  }

  lines.push("\nGenerate the JSON now.");
  return lines.join("\n");
}

async function callLlm(cfg: LlmConfig, system: string, user: string, timeoutMs = 180000): Promise<string> {
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return content;
  } finally {
    clearTimeout(id);
  }
}

export async function generateDescriptions(celeb: CelebrityInput): Promise<GeneratedDescriptions> {
  const cfg = await getLlmConfig();
  let wikiEn = "";
  let wikiRu = "";
  let wikiUz = "";
  if (celeb.wikidataId) {
    const sitelinks = await fetchWikidataSitelinks(celeb.wikidataId);
    if (sitelinks.enwiki) wikiEn = await fetchWikipediaExtract("en", sitelinks.enwiki);
    if (sitelinks.ruwiki) wikiRu = await fetchWikipediaExtract("ru", sitelinks.ruwiki);
    if (sitelinks.uzwiki) wikiUz = await fetchWikipediaExtract("uz", sitelinks.uzwiki);
  }

  const prompt = buildUserPrompt(celeb, wikiEn, wikiRu, wikiUz);
  const raw = await callLlm(cfg, SYSTEM_PROMPT, prompt);
  const parsed = parseJsonLoose(raw);
  const sources: string[] = [];
  if (wikiEn) sources.push("en-wiki");
  if (wikiRu) sources.push("ru-wiki");
  if (wikiUz) sources.push("uz-wiki");

  return {
    uz: (parsed.uz ?? "").trim(),
    ru: (parsed.ru ?? "").trim(),
    en: (parsed.en ?? "").trim(),
    sources,
  };
}

export async function pingLlm(): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const cfg = await getLlmConfig();
  const t0 = Date.now();
  try {
    const content = await callLlm(
      cfg,
      "You reply with exactly one word in English.",
      "Say ok",
      15000,
    );
    const latencyMs = Date.now() - t0;
    if (!content) return { ok: false, error: "empty response" };
    return { ok: true, latencyMs };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

import { parseArgs } from "node:util";

import { basicAuthHeader, config } from "./config.ts";

type CelebrityRow = {
  id: string;
  name: string;
  nameRu: string | null;
  category: string | null;
  wikidataId: string | null;
  descriptionUz: string | null;
  descriptionRu: string | null;
  descriptionEn: string | null;
};

const SYSTEM_PROMPT = `You are a concise bilingual biography writer.

Given a person's name and Wikipedia excerpts, produce short, informative biographical descriptions in three languages: Uzbek (Latin script), Russian, and English.

Rules for every description:
- 200-350 characters, 1-3 sentences, natural for the language
- State the person's main claim to fame: profession, nationality, era, headline achievements
- Include concrete facts ONLY if they appear in the provided Wikipedia text
- Do not invent, speculate, or add facts not in the source
- Write in the target language natively (no transliteration)
- Uzbek must be Latin script

Respond with a single JSON object: {"uz": "...", "ru": "...", "en": "..."}

Output ONLY the JSON, no commentary, no markdown fences.`;

async function listCelebrities(): Promise<CelebrityRow[]> {
  const res = await fetch(
    `${config.prodUrl}/api/admin/celebrities?missingDescriptions=1&limit=5000`,
    { headers: { Authorization: basicAuthHeader() } },
  );
  if (!res.ok) throw new Error(`list HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { items: CelebrityRow[] };
  return data.items;
}

async function wikidataSitelinks(qid: string): Promise<Record<string, string>> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&sitefilter=enwiki|ruwiki|uzwiki&format=json`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": config.userAgent } });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      entities?: Record<string, { sitelinks?: Record<string, { title: string }> }>;
    };
    const entity = data.entities?.[qid];
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(entity?.sitelinks ?? {})) {
      if (v?.title) out[k] = v.title;
    }
    return out;
  } catch {
    return {};
  }
}

async function wikipediaExtract(lang: string, title: string): Promise<string> {
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": config.userAgent } });
    if (!res.ok) return "";
    const data = (await res.json()) as { extract?: string };
    return (data.extract ?? "").trim();
  } catch {
    return "";
  }
}

function parseLmJson(text: string): { uz?: string; ru?: string; en?: string } {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.split("```")[1] ?? "";
    if (cleaned.startsWith("json")) cleaned = cleaned.slice(4);
  }
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("lm_response_not_json");
  }
}

async function generate(
  row: CelebrityRow,
): Promise<{ uz: string; ru: string; en: string; sources: string[] }> {
  const sitelinks = row.wikidataId ? await wikidataSitelinks(row.wikidataId) : {};
  const wikiEn = sitelinks.enwiki ? await wikipediaExtract("en", sitelinks.enwiki) : "";
  const wikiRu = sitelinks.ruwiki ? await wikipediaExtract("ru", sitelinks.ruwiki) : "";
  const wikiUz = sitelinks.uzwiki ? await wikipediaExtract("uz", sitelinks.uzwiki) : "";

  const lines: string[] = [`Person: ${row.name}`];
  if (row.nameRu) lines.push(`Russian name: ${row.nameRu}`);
  if (row.category) lines.push(`Category hint: ${row.category}`);
  if (wikiEn) lines.push("\nWikipedia (English):", wikiEn.slice(0, 1800));
  if (wikiRu) lines.push("\nWikipedia (Russian):", wikiRu.slice(0, 1800));
  if (wikiUz) lines.push("\nWikipedia (Uzbek):", wikiUz.slice(0, 1800));
  lines.push("\nGenerate the JSON now.");

  const body = {
    model: config.lmModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: lines.join("\n") },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  };

  const res = await fetch(`${config.lmBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.lmApiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const parsed = parseLmJson(data.choices[0].message.content);

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

async function patchCelebrity(id: string, fields: { uz?: string; ru?: string; en?: string }) {
  const body: Record<string, string | null> = {};
  if (fields.uz) body.descriptionUz = fields.uz;
  if (fields.ru) body.descriptionRu = fields.ru;
  if (fields.en) body.descriptionEn = fields.en;
  if (Object.keys(body).length === 0) return;
  const res = await fetch(`${config.prodUrl}/api/admin/celebrities/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH HTTP ${res.status}: ${await res.text()}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      sleep: { type: "string", default: "300" },
    },
  });

  if (!config.adminPassword) {
    console.error("ADMIN_PASSWORD is not set in scripts/.env.local");
    process.exit(2);
  }

  const sleepMs = Number(values.sleep);
  let rows = await listCelebrities();
  if (values.limit) rows = rows.slice(0, Number(values.limit));
  console.log(`[descriptions] ${rows.length} celebrities missing at least one description`);
  console.log(`[descriptions] LM: ${config.lmBaseUrl} model=${config.lmModel}`);

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const g = await generate(row);
      if (!g.uz && !g.ru && !g.en) throw new Error("empty_lm_response");
      await patchCelebrity(row.id, { uz: g.uz, ru: g.ru, en: g.en });
      ok++;
      console.log(
        `  [${i + 1}/${rows.length}] ✓ ${row.name} [${g.sources.join(",") || "no-wiki"}]`,
      );
      await new Promise((r) => setTimeout(r, sleepMs));
    } catch (e) {
      failed++;
      console.warn(`  [${i + 1}/${rows.length}] ✗ ${row.name}: ${(e as Error).message}`);
    }
  }
  console.log(`[descriptions] done: ${ok} ok, ${failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

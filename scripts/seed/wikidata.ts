import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { config } from "./config.ts";

const SPARQL_URL = "https://query.wikidata.org/sparql";

export type Category = "uz" | "cis" | "world";

export type WikidataEntry = {
  name: string;
  nameRu: string;
  descriptionEn: string;
  descriptionRu: string;
  category: Category;
  wikidataId: string;
  imageUrl: string;
  photoPath: string;
  sitelinks: number;
};

const QUERIES: Record<Category, string> = {
  uz: `
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
`,
  cis: `
SELECT DISTINCT ?person ?personLabel ?personLabelRu ?descEn ?descRu ?image ?sitelinks WHERE {
  VALUES ?country { wd:Q159 wd:Q212 wd:Q184 wd:Q232 wd:Q813 wd:Q863 wd:Q227 wd:Q399 wd:Q217 wd:Q874 }
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
`,
  world: `
SELECT DISTINCT ?person ?personLabel ?personLabelRu ?descEn ?descRu ?image ?sitelinks WHERE {
  ?person wdt:P31 wd:Q5 ;
          wdt:P18 ?image ;
          wikibase:sitelinks ?sitelinks .
  VALUES ?occ { wd:Q33999 wd:Q10800557 wd:Q10798782 wd:Q177220 wd:Q639669 wd:Q937857 }
  ?person wdt:P106 ?occ .
  FILTER(?sitelinks > 50)
  OPTIONAL { ?person rdfs:label ?personLabelRu . FILTER(LANG(?personLabelRu) = "ru") }
  OPTIONAL { ?person schema:description ?descEn . FILTER(LANG(?descEn) = "en") }
  OPTIONAL { ?person schema:description ?descRu . FILTER(LANG(?descRu) = "ru") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . ?person rdfs:label ?personLabel . }
}
ORDER BY DESC(?sitelinks)
LIMIT {limit}
`,
};

type SparqlBinding = Record<string, { value: string }>;

async function sparql(query: string, retries = 3): Promise<SparqlBinding[]> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const body = new URLSearchParams({ query, format: "json" });
      const res = await fetch(SPARQL_URL, {
        method: "POST",
        headers: {
          "User-Agent": config.userAgent,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results: { bindings: SparqlBinding[] } };
      return data.results.bindings;
    } catch (e) {
      lastErr = e;
      console.warn(`sparql attempt ${attempt + 1} failed: ${(e as Error).message}`);
      await sleep(3000 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("sparql_failed");
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": config.userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

function extFromUrl(url: string): string {
  const path = new URL(url).pathname;
  const ext = path.split(".").pop()?.toLowerCase() ?? "jpg";
  return ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchCategory(
  category: Category,
  limit: number,
  outDir: string,
): Promise<WikidataEntry[]> {
  const photosDir = resolve(outDir, "photos");
  mkdirSync(photosDir, { recursive: true });

  const query = QUERIES[category].replace("{limit}", String(limit));
  console.log(`[wikidata] fetching category=${category} limit=${limit} ...`);
  const bindings = await sparql(query);
  console.log(`[wikidata]   got ${bindings.length} entries — downloading photos ...`);

  const entries: WikidataEntry[] = [];
  let idx = 0;
  for (const b of bindings) {
    idx++;
    const name = b.personLabel?.value?.trim() ?? "";
    const nameRu = b.personLabelRu?.value?.trim() ?? "";
    const descriptionEn = b.descEn?.value?.trim() ?? "";
    const descriptionRu = b.descRu?.value?.trim() ?? "";
    const imageUrl = b.image?.value ?? "";
    const personUrl = b.person?.value ?? "";
    const wikidataId = personUrl.split("/").pop() ?? "";
    const sitelinks = Number(b.sitelinks?.value ?? "0");
    if (!name || name.startsWith("Q") || !imageUrl) continue;

    const hash = createHash("sha1").update(imageUrl).digest("hex").slice(0, 16);
    const ext = extFromUrl(imageUrl);
    const filename = `${category}-${hash}.${ext}`;
    const photoPath = join(photosDir, filename);

    if (!existsSync(photoPath)) {
      try {
        await download(imageUrl, photoPath);
        console.log(`  [${idx}/${bindings.length}] ${category} ${name}`);
        await sleep(150);
      } catch (e) {
        console.warn(`  [${idx}/${bindings.length}] download failed ${name}: ${(e as Error).message}`);
        continue;
      }
    }

    entries.push({
      name,
      nameRu,
      descriptionEn,
      descriptionRu,
      category,
      wikidataId,
      imageUrl,
      photoPath,
      sitelinks,
    });
  }

  console.log(`[wikidata] category=${category} done: ${entries.length} usable entries`);
  return entries;
}

export function saveManifest(outDir: string, entries: WikidataEntry[]): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "manifest.json");
  writeFileSync(path, JSON.stringify(entries, null, 2));
  return path;
}

export function loadManifest(outDir: string): WikidataEntry[] {
  const path = join(outDir, "manifest.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8")) as WikidataEntry[];
}

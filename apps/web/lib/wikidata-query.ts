const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const TIMEOUT_MS = 55_000;
const USER_AGENT =
  "starface-admin/1.0 (https://starface.uz; admin@starface.uz) CloudflareWorkers";

export type RawCandidate = {
  qid: string;
  name: string;
  nameRu: string | null;
  imageFile: string | null;
  dob: string | null;
  dod: string | null;
  occupation: string | null;
  genderLabel: string | null;
  sitelinks: number | null;
};

type SparqlResult = {
  results?: {
    bindings?: Array<Record<string, { value: string; type?: string }>>;
  };
};

function qidFromUri(uri: string): string | null {
  const m = /\/entity\/(Q\d+)$/.exec(uri);
  return m ? m[1] : null;
}

function imageFileFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const decoded = decodeURIComponent(uri.replace(/^.*\/Special:FilePath\//, ""));
  return decoded || null;
}

async function sparqlFetch(query: string): Promise<SparqlResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SPARQL_ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/sparql-results+json",
        "Content-Type": "application/sparql-query",
      },
      body: query,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`sparql_${res.status}${body ? `:${body.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as SparqlResult;
  } finally {
    clearTimeout(timer);
  }
}

export async function runSparql(query: string, limit: number): Promise<RawCandidate[]> {
  const finalQuery = query.replaceAll(
    "{{LIMIT}}",
    String(Math.min(1000, Math.max(1, limit))),
  );
  let data: SparqlResult;
  try {
    data = await sparqlFetch(finalQuery);
  } catch (first) {
    if ((first as Error).name === "AbortError") {
      throw new Error("sparql_timeout");
    }
    data = await sparqlFetch(finalQuery);
  }
  const rows = data.results?.bindings ?? [];
  const seen = new Set<string>();
  const out: RawCandidate[] = [];
  for (const row of rows) {
    const qid = qidFromUri(row.person?.value ?? "");
    if (!qid || seen.has(qid)) continue;
    seen.add(qid);
    const sitelinksRaw = row.sitelinks?.value;
    const sitelinks =
      sitelinksRaw !== undefined && sitelinksRaw !== ""
        ? Number(sitelinksRaw)
        : null;
    out.push({
      qid,
      name: row.personLabel?.value ?? qid,
      nameRu: row.personRuLabel?.value ?? null,
      imageFile: imageFileFromUri(row.image?.value),
      dob: row.dob?.value ?? null,
      dod: row.dod?.value ?? null,
      occupation: row.occupationLabel?.value ?? null,
      genderLabel: row.genderLabel?.value ?? null,
      sitelinks: sitelinks !== null && Number.isFinite(sitelinks) ? sitelinks : null,
    });
  }
  return out;
}

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const TIMEOUT_MS = 30_000;

export type RawCandidate = {
  qid: string;
  name: string;
  nameRu: string | null;
  imageFile: string | null;
  dob: string | null;
  dod: string | null;
  occupation: string | null;
  genderLabel: string | null;
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

export async function runSparql(query: string, limit: number): Promise<RawCandidate[]> {
  const finalQuery = query.replaceAll(
    "{{LIMIT}}",
    String(Math.min(1000, Math.max(1, limit))),
  );
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(finalQuery)}&format=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "starface-admin/1.0 (dataset enrichment)",
        Accept: "application/sparql-results+json",
      },
    });
    if (!res.ok) throw new Error(`sparql_${res.status}`);
    const data = (await res.json()) as SparqlResult;
    const rows = data.results?.bindings ?? [];
    const seen = new Set<string>();
    const out: RawCandidate[] = [];
    for (const row of rows) {
      const qid = qidFromUri(row.person?.value ?? "");
      if (!qid || seen.has(qid)) continue;
      seen.add(qid);
      out.push({
        qid,
        name: row.personLabel?.value ?? qid,
        nameRu: row.personRuLabel?.value ?? null,
        imageFile: imageFileFromUri(row.image?.value),
        dob: row.dob?.value ?? null,
        dod: row.dod?.value ?? null,
        occupation: row.occupationLabel?.value ?? null,
        genderLabel: row.genderLabel?.value ?? null,
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

const FETCH_TIMEOUT_MS = 4000;

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "starface-admin/1.0 (dataset enrichment)" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type PhotoCandidate = {
  id: string;
  fileName: string;
  fullUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  sourceUrl: string;
  sourceType: "p18" | "category";
  license: string | null;
};

const wikidataEntity = (qid: string) =>
  `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json?props=claims`;

type WikidataClaims = {
  entities?: Record<
    string,
    { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>> }
  >;
};

async function getClaim(qid: string, property: string): Promise<string | null> {
  const data = await fetchJson<WikidataClaims>(wikidataEntity(qid));
  const claim = data?.entities?.[qid]?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  return typeof claim === "string" ? claim : null;
}

const commonsImageInfo = (filenames: string[]) => {
  const titles = filenames.map((f) => `File:${f}`).join("|");
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    titles,
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "512",
  });
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
};

type CommonsResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: Array<{
          url?: string;
          thumburl?: string;
          width?: number;
          height?: number;
          extmetadata?: { LicenseShortName?: { value?: string } };
        }>;
      }
    >;
  };
};

async function imageInfo(
  filenames: string[],
  sourceType: "p18" | "category",
): Promise<PhotoCandidate[]> {
  if (filenames.length === 0) return [];
  const data = await fetchJson<CommonsResponse>(commonsImageInfo(filenames));
  const pages = Object.values(data?.query?.pages ?? {});
  const out: PhotoCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const fileName = page.title?.replace(/^File:/, "");
    if (!info || !fileName || !info.url || !info.thumburl) continue;
    const width = info.width ?? 0;
    const height = info.height ?? 0;
    if (width < 300 || height < 300) continue;
    out.push({
      id: `${sourceType}:${fileName}`,
      fileName,
      fullUrl: info.url,
      thumbUrl: info.thumburl,
      width,
      height,
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
      sourceType,
      license: info.extmetadata?.LicenseShortName?.value ?? null,
    });
  }
  return out;
}

const commonsCategoryMembers = (cat: string) => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    list: "categorymembers",
    cmtitle: `Category:${cat}`,
    cmtype: "file",
    cmlimit: "30",
  });
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
};

type CategoryMembersResponse = {
  query?: { categorymembers?: Array<{ title?: string }> };
};

export async function findCandidatesForWikidata(qid: string): Promise<PhotoCandidate[]> {
  const p18 = await getClaim(qid, "P18");
  const p373 = await getClaim(qid, "P373");

  const p18Candidates = p18 ? await imageInfo([p18], "p18") : [];

  let catCandidates: PhotoCandidate[] = [];
  if (p373) {
    const members = await fetchJson<CategoryMembersResponse>(commonsCategoryMembers(p373));
    const fileNames = (members?.query?.categorymembers ?? [])
      .map((m) => m.title?.replace(/^File:/, ""))
      .filter((n): n is string => Boolean(n))
      .slice(0, 20);
    catCandidates = await imageInfo(fileNames, "category");
  }

  const seen = new Set<string>();
  const unique: PhotoCandidate[] = [];
  for (const c of [...p18Candidates, ...catCandidates]) {
    if (seen.has(c.fullUrl)) continue;
    seen.add(c.fullUrl);
    unique.push(c);
  }
  return unique;
}

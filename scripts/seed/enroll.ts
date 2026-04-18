import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { join } from "node:path";

import { basicAuthHeader, config } from "./config.ts";
import { embedImage, FaceEmbedError } from "./face-embed.ts";
import { loadManifest, type WikidataEntry } from "./wikidata.ts";

type EnrollPhoto = {
  imageBase64: string;
  imageExt: string;
  embedding: number[];
  detScore: number;
  faceQuality: "high" | "medium";
  isPrimary: boolean;
  source?: string;
  sourceUrl?: string;
};

type EnrollCelebrity = {
  externalId?: string;
  name: string;
  nameRu: string | null;
  category: string | null;
  gender?: "M" | "F" | null;
  age?: number | null;
  popularity?: number;
  descriptionUz?: string | null;
  descriptionRu?: string | null;
  descriptionEn?: string | null;
  wikidataId?: string | null;
  photos: EnrollPhoto[];
};

type EnrollResponse = {
  inserted: number;
  updated: number;
  failed: Array<{ externalId?: string; name?: string; reason: string }>;
};

type Progress = {
  done: string[];
  failed: Array<{ externalId: string; reason: string }>;
};

const BATCH_SIZE = 25;

function loadProgress(path: string): Progress {
  if (!existsSync(path)) return { done: [], failed: [] };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Progress;
  } catch {
    return { done: [], failed: [] };
  }
}

function saveProgress(path: string, p: Progress): void {
  writeFileSync(path, JSON.stringify(p, null, 2));
}

function extFromPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "jpg";
  return ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
}

async function buildPhoto(entry: WikidataEntry): Promise<EnrollPhoto> {
  const buffer = readFileSync(entry.photoPath);
  const embed = await embedImage(buffer);
  return {
    imageBase64: buffer.toString("base64"),
    imageExt: extFromPath(entry.photoPath),
    embedding: embed.embedding,
    detScore: embed.detScore,
    faceQuality: embed.faceQuality,
    isPrimary: true,
    source: "wikidata",
    sourceUrl: entry.imageUrl,
  };
}

async function postBatch(batch: EnrollCelebrity[]): Promise<EnrollResponse> {
  const res = await fetch(`${config.prodUrl}/api/admin/enroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuthHeader(),
    },
    body: JSON.stringify({ celebrities: batch }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`enroll HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as EnrollResponse;
}

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string", default: join(config.seedOutDir, "manifest.json") },
      category: { type: "string" },
      limit: { type: "string" },
      "progress-file": { type: "string", default: ".seed-progress.json" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  if (!config.adminPassword && !values["dry-run"]) {
    console.error("ADMIN_PASSWORD is not set. Copy scripts/.env.example → scripts/.env.local first.");
    process.exit(2);
  }

  const manifestPath = values.manifest as string;
  const progressPath = values["progress-file"] as string;

  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    console.error(`run 'pnpm --filter @starface/scripts fetch-wikidata' first`);
    process.exit(2);
  }

  const outDir = manifestPath.replace(/\/manifest\.json$/, "");
  let entries = loadManifest(outDir);
  if (values.category) entries = entries.filter((e) => e.category === values.category);
  if (values.limit) entries = entries.slice(0, Number(values.limit));

  const progress = loadProgress(progressPath);
  const doneSet = new Set(progress.done);
  const remaining = entries.filter((e) => !doneSet.has(e.wikidataId || e.name));

  console.log(
    `[enroll] manifest=${entries.length} done=${doneSet.size} remaining=${remaining.length} target=${config.prodUrl}`,
  );

  let embedded: EnrollCelebrity[] = [];
  let idx = 0;
  for (const e of remaining) {
    idx++;
    const key = e.wikidataId || e.name;
    try {
      const photo = await buildPhoto(e);
      embedded.push({
        externalId: e.wikidataId || undefined,
        name: e.name,
        nameRu: e.nameRu || null,
        category: e.category,
        popularity: Math.max(1, Math.min(100, Math.round(e.sitelinks / 2))),
        descriptionEn: e.descriptionEn || null,
        descriptionRu: e.descriptionRu || null,
        wikidataId: e.wikidataId || null,
        photos: [photo],
      });
      console.log(
        `  [${idx}/${remaining.length}] ✓ ${e.name} (faceQuality=${photo.faceQuality}, det=${photo.detScore.toFixed(2)})`,
      );
    } catch (err) {
      const reason = err instanceof FaceEmbedError ? err.code : (err as Error).message;
      console.warn(`  [${idx}/${remaining.length}] skip ${e.name}: ${reason}`);
      progress.failed.push({ externalId: key, reason });
      saveProgress(progressPath, progress);
      continue;
    }

    if (embedded.length >= BATCH_SIZE) {
      await flushBatch(embedded, progress, progressPath, values["dry-run"]);
      embedded = [];
    }
  }

  if (embedded.length) {
    await flushBatch(embedded, progress, progressPath, values["dry-run"]);
  }

  console.log(
    `\n[enroll] done. success=${progress.done.length} failed=${progress.failed.length} progress=${progressPath}`,
  );
}

async function flushBatch(
  batch: EnrollCelebrity[],
  progress: Progress,
  progressPath: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    console.log(`  [dry-run] would POST ${batch.length} celebrities`);
    for (const c of batch) progress.done.push(c.externalId ?? c.name);
    saveProgress(progressPath, progress);
    return;
  }
  const result = await postBatch(batch);
  console.log(
    `  [batch] → inserted=${result.inserted} updated=${result.updated} failed=${result.failed.length}`,
  );
  for (const c of batch) {
    const wasFailed = result.failed.find((f) => f.externalId === c.externalId || f.name === c.name);
    if (wasFailed) progress.failed.push({ externalId: c.externalId ?? c.name, reason: wasFailed.reason });
    else progress.done.push(c.externalId ?? c.name);
  }
  saveProgress(progressPath, progress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

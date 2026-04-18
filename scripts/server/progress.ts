import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPTS_DIR = resolve(import.meta.dirname ?? "", "..");

export type SeedProgress = {
  exists: boolean;
  path: string;
  updatedAt?: number;
  done: string[];
  failed: Array<{ externalId: string; reason: string }>;
};

export function readSeedProgress(progressFile = ".seed-progress.json"): SeedProgress {
  const path = resolve(SCRIPTS_DIR, progressFile);
  if (!existsSync(path)) {
    return { exists: false, path, done: [], failed: [] };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as { done?: string[]; failed?: SeedProgress["failed"] };
    const stat = statSync(path);
    return {
      exists: true,
      path,
      updatedAt: stat.mtimeMs,
      done: Array.isArray(data.done) ? data.done : [],
      failed: Array.isArray(data.failed) ? data.failed : [],
    };
  } catch (err) {
    return {
      exists: true,
      path,
      done: [],
      failed: [{ externalId: "__parse__", reason: (err as Error).message }],
    };
  }
}

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { config } from "../seed/config.ts";

const SCRIPTS_DIR = resolve(import.meta.dirname ?? "", "..");

function absPath(p: string): string {
  return isAbsolute(p) ? p : resolve(SCRIPTS_DIR, p);
}

async function pingUrl(url: string, method: "HEAD" | "GET" = "HEAD"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(url, { method, signal: controller.signal });
      return res.status > 0 && res.status < 500;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

export type EnvReport = {
  envFile: { path: string; exists: boolean };
  prodUrl: { value: string; reachable: boolean };
  lmBaseUrl: { value: string; reachable: boolean };
  lmModel: { value: string };
  adminUser: { value: string };
  adminPassword: { set: boolean };
  lmApiKey: { set: boolean };
  facenetModel: { path: string; exists: boolean };
  yunetModel: { path: string; exists: boolean };
  seedOutDir: { path: string; exists: boolean };
  progressFile: { path: string; exists: boolean };
};

export async function buildEnvReport(): Promise<EnvReport> {
  const facenetPath = absPath(config.facenetModelPath);
  const yunetPath = absPath(config.yunetModelPath);
  const seedDir = absPath(config.seedOutDir);
  const envFile = resolve(SCRIPTS_DIR, ".env.local");
  const progressFile = resolve(SCRIPTS_DIR, ".seed-progress.json");

  const [prodReachable, lmReachable] = await Promise.all([
    pingUrl(config.prodUrl, "GET"),
    pingUrl(`${config.lmBaseUrl.replace(/\/+$/, "")}/models`, "GET"),
  ]);

  return {
    envFile: { path: envFile, exists: existsSync(envFile) },
    prodUrl: { value: config.prodUrl, reachable: prodReachable },
    lmBaseUrl: { value: config.lmBaseUrl, reachable: lmReachable },
    lmModel: { value: config.lmModel },
    adminUser: { value: config.adminUser },
    adminPassword: { set: config.adminPassword.length > 0 },
    lmApiKey: { set: config.lmApiKey.length > 0 },
    facenetModel: { path: facenetPath, exists: existsSync(facenetPath) },
    yunetModel: { path: yunetPath, exists: existsSync(yunetPath) },
    seedOutDir: { path: seedDir, exists: existsSync(seedDir) },
    progressFile: { path: progressFile, exists: existsSync(progressFile) },
  };
}

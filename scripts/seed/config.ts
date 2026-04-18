import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const ENV_FILE = resolve(process.cwd(), ".env.local");
const dotenv = loadDotEnv(ENV_FILE);

function read(key: string, fallback?: string): string {
  return process.env[key] ?? dotenv[key] ?? fallback ?? "";
}

export const config = {
  prodUrl: read("PROD_URL", "http://localhost:8788"),
  adminUser: read("ADMIN_USER", "admin"),
  adminPassword: read("ADMIN_PASSWORD", ""),
  facenetModelPath: read("FACENET_MODEL_PATH", "./models/mobilefacenet.onnx"),
  yunetModelPath: read("YUNET_MODEL_PATH", "./models/yunet.onnx"),
  lmBaseUrl: read("LM_BASE_URL", "http://127.0.0.1:1234/v1"),
  lmApiKey: read("LM_API_KEY", "lmstudio"),
  lmModel: read("LM_MODEL", "google/gemma-2-9b-it"),
  seedOutDir: read("SEED_OUT_DIR", "./seeds/wikidata"),
  userAgent: read(
    "SEED_USER_AGENT",
    "StarFaceUZ-seed/0.1 (https://github.com/; contact@starface.uz)",
  ),
};

export function basicAuthHeader(): string {
  const pair = `${config.adminUser}:${config.adminPassword}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

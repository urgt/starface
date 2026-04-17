import { inArray } from "drizzle-orm";

import { db, schema } from "./db";

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const DEFAULTS: LlmConfig = {
  baseUrl: process.env.LM_BASE_URL ?? "http://127.0.0.1:1234/v1",
  apiKey: process.env.LM_API_KEY ?? "lmstudio",
  model: process.env.LM_MODEL ?? "google/gemma-4-e4b",
};

const KEYS = {
  baseUrl: "llm.base_url",
  apiKey: "llm.api_key",
  model: "llm.model",
};

export async function getLlmConfig(): Promise<LlmConfig> {
  try {
    const rows = await db
      .select({ key: schema.appSettings.key, value: schema.appSettings.value })
      .from(schema.appSettings)
      .where(inArray(schema.appSettings.key, [KEYS.baseUrl, KEYS.apiKey, KEYS.model]));
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      baseUrl: (map.get(KEYS.baseUrl) || DEFAULTS.baseUrl).trim(),
      apiKey: (map.get(KEYS.apiKey) || DEFAULTS.apiKey).trim(),
      model: (map.get(KEYS.model) || DEFAULTS.model).trim(),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setLlmConfig(patch: Partial<LlmConfig>): Promise<void> {
  const entries: { key: string; value: string }[] = [];
  if (patch.baseUrl !== undefined) entries.push({ key: KEYS.baseUrl, value: patch.baseUrl });
  if (patch.apiKey !== undefined) entries.push({ key: KEYS.apiKey, value: patch.apiKey });
  if (patch.model !== undefined) entries.push({ key: KEYS.model, value: patch.model });
  if (!entries.length) return;
  for (const e of entries) {
    await db
      .insert(schema.appSettings)
      .values({ key: e.key, value: e.value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: e.value, updatedAt: new Date() },
      });
  }
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 4) return "••••";
  return key.slice(0, 2) + "•".repeat(Math.max(4, key.length - 4)) + key.slice(-2);
}

export { KEYS as LLM_SETTING_KEYS };

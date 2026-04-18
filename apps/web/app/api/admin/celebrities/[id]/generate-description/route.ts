import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { GeminiError, generateDescriptions } from "@/lib/llm/gemini";
import {
  buildDescriptionPrompt,
  type CelebrityInput,
  type WikipediaContext,
} from "@/lib/llm/prompts";
import { LANGUAGES, type Language } from "@/lib/llm/schema";
import { fetchSummaries } from "@/lib/wikipedia";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({
  languages: z.array(z.enum(["uz", "ru", "en"])).min(1).max(3).optional(),
  skipWikipedia: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json(
      { error: "bad_request", detail: (e as Error).message },
      { status: 400 },
    );
  }

  const languages: Language[] = body.languages ?? LANGUAGES;

  const [celeb] = await db
    .select({
      id: schema.celebrities.id,
      name: schema.celebrities.name,
      nameRu: schema.celebrities.nameRu,
      wikidataId: schema.celebrities.wikidataId,
      category: schema.celebrities.category,
      gender: schema.celebrities.gender,
      age: schema.celebrities.age,
      descriptionUz: schema.celebrities.descriptionUz,
      descriptionRu: schema.celebrities.descriptionRu,
      descriptionEn: schema.celebrities.descriptionEn,
    })
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { env } = getCloudflareContext();
  const apiKey = (env as unknown as { GEMINI_API_KEY?: string }).GEMINI_API_KEY;
  const model = env.GEMINI_MODEL;
  if (!apiKey) {
    return NextResponse.json(
      { error: "internal", detail: "GEMINI_API_KEY missing" },
      { status: 500 },
    );
  }

  const celebInput: CelebrityInput = {
    name: celeb.name,
    nameRu: celeb.nameRu,
    wikidataId: celeb.wikidataId,
    category: celeb.category,
    gender: celeb.gender,
    age: celeb.age,
  };

  let wiki: WikipediaContext | null = null;
  let source: "wikipedia" | "none" = "none";
  if (celeb.wikidataId && !body.skipWikipedia) {
    const summaries = await fetchSummaries(celeb.wikidataId, LANGUAGES);
    if (summaries.uz || summaries.ru || summaries.en) {
      wiki = summaries;
      source = "wikipedia";
    }
  }

  const existing: Partial<Record<Language, string>> = {};
  if (celeb.descriptionUz) existing.uz = celeb.descriptionUz;
  if (celeb.descriptionRu) existing.ru = celeb.descriptionRu;
  if (celeb.descriptionEn) existing.en = celeb.descriptionEn;

  const prompt = buildDescriptionPrompt(celebInput, wiki, languages, existing);

  const start = Date.now();
  let result: Awaited<ReturnType<typeof generateDescriptions>> | null = null;
  let errorCode: string | null = null;

  let errorDetail: string | null = null;
  try {
    result = await generateDescriptions({ apiKey, model, prompt, languages });
  } catch (e) {
    if (e instanceof GeminiError) {
      errorCode = e.code;
      errorDetail = e.detail;
    } else {
      errorCode = "internal";
      errorDetail = (e as Error).message ?? null;
    }
    console.error("generate-description failed", {
      celebrityId: celeb.id,
      errorCode,
      errorDetail,
      model,
    });
  }

  const latencyMs = Date.now() - start;
  const success = result !== null && errorCode === null;

  await db.insert(schema.events).values({
    brandId: null,
    resultId: null,
    eventType: "admin.description_generated",
    metadata: {
      celebrityId: celeb.id,
      model,
      languages,
      latencyMs,
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      source,
      success,
      ...(errorCode ? { errorCode } : {}),
    },
  });

  if (!success || !result) {
    const detail = errorDetail ?? undefined;
    if (errorCode === "rate_limited") {
      return NextResponse.json({ error: "rate_limited", detail }, { status: 429 });
    }
    if (errorCode === "safety_blocked") {
      return NextResponse.json({ error: "safety_blocked", detail }, { status: 422 });
    }
    if (errorCode === "parse_error") {
      return NextResponse.json({ error: "internal", detail: detail ?? "parse_error" }, { status: 500 });
    }
    return NextResponse.json({ error: "upstream_error", detail }, { status: 502 });
  }

  const missing = languages.filter((l) => !result.descriptions[l]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "internal", detail: `missing_languages:${missing.join(",")}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ...result.descriptions, source, model, latencyMs });
}

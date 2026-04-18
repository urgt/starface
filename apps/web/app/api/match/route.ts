import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordEvent } from "@/lib/analytics";
import { appConfig, mapCosineToPct } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { saveUserPhoto } from "@/lib/storage";

export const dynamic = "force-dynamic";

const EMBEDDING_DIM = 512;

const bodySchema = z.object({
  brandId: z.string().min(1).max(64),
  embedding: z.array(z.number()).length(EMBEDDING_DIM),
  userPhotoBase64: z.string().min(100),
  detScore: z.number().min(0).max(1),
  faceQuality: z.enum(["high", "medium"]),
  clientSex: z.enum(["M", "F"]).nullable().optional(),
  clientAge: z.number().int().nullable().optional(),
});

type VectorMeta = {
  celebrityId: string;
  celebrityPhotoId: string;
  photoPath: string;
  gender: "M" | "F" | null;
  age: number | null;
  popularity: number;
  active: boolean;
};

type Candidate = {
  celebrityId: string;
  celebrityPhotoId: string;
  photoPath: string;
  gender: "M" | "F" | null;
  age: number | null;
  cosine: number;
  score: number;
};

type RankContext = {
  userSex: "M" | "F" | null;
  userAge: number | null;
  applyGenderPenalty: boolean;
};

function rerank(
  matches: VectorizeMatch[],
  ctx: RankContext,
): Candidate[] {
  const { matchGenderPenalty, matchAgePenalty, matchTiebreakDelta } = appConfig;

  const byCeleb = new Map<string, { match: VectorizeMatch; meta: VectorMeta }>();
  for (const m of matches) {
    const meta = m.metadata as unknown as VectorMeta | undefined;
    if (!meta || meta.active === false) continue;
    if (!byCeleb.has(meta.celebrityId)) byCeleb.set(meta.celebrityId, { match: m, meta });
  }

  const candidates: Candidate[] = Array.from(byCeleb.values()).map(({ match, meta }) => {
    const cosine = Number(match.score);
    let score = cosine;
    if (ctx.applyGenderPenalty && ctx.userSex && meta.gender && meta.gender !== ctx.userSex) {
      score -= matchGenderPenalty;
    }
    if (ctx.userAge != null && meta.age != null) {
      const delta = Math.min(Math.abs(ctx.userAge - meta.age) / 30, 1);
      score -= matchAgePenalty * delta;
    }
    return {
      celebrityId: meta.celebrityId,
      celebrityPhotoId: meta.celebrityPhotoId,
      photoPath: meta.photoPath,
      gender: meta.gender,
      age: meta.age,
      cosine,
      score,
    };
  });

  candidates.sort((a, b) => b.score - a.score);

  if (ctx.applyGenderPenalty && ctx.userSex && candidates.length > 1) {
    const top = candidates[0];
    if (top.gender && top.gender !== ctx.userSex) {
      const sameSex = candidates.find((c) => c.gender === ctx.userSex);
      if (sameSex && top.cosine - sameSex.cosine < matchTiebreakDelta) {
        candidates.splice(candidates.indexOf(sameSex), 1);
        candidates.unshift(sameSex);
      }
    }
  }

  return candidates;
}

export async function POST(req: Request) {
  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const [brand] = await db
    .select({ id: schema.brands.id, active: schema.brands.active })
    .from(schema.brands)
    .where(eq(schema.brands.id, payload.brandId))
    .limit(1);
  if (!brand || !brand.active) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }

  const userSex = payload.clientSex ?? null;
  const userAge = payload.clientAge ?? null;
  const faceQuality = payload.faceQuality;

  const { env } = getCloudflareContext();
  const k = Math.max(10, Math.min(200, appConfig.matchRerankK));

  const queryResult = await env.FACES.query(payload.embedding, {
    topK: k,
    returnMetadata: "all",
    filter: { active: { $eq: true } },
  });

  if (!queryResult.matches.length) {
    await recordEvent({
      brandId: brand.id,
      eventType: "match_failed",
      metadata: { code: "empty_db" },
    });
    return NextResponse.json({ error: "no_celebrities" }, { status: 503 });
  }

  // buffalo_l gender head misfires on <16yo + blurry faces; avoid false penalty there.
  const applyGenderPenalty = userSex !== null && faceQuality === "high" && (userAge ?? 99) >= 16;

  const ranked = rerank(queryResult.matches, { userSex, userAge, applyGenderPenalty });
  if (!ranked.length) {
    await recordEvent({
      brandId: brand.id,
      eventType: "match_failed",
      metadata: { code: "no_active_matches" },
    });
    return NextResponse.json({ error: "no_celebrities" }, { status: 503 });
  }

  const top = ranked[0];
  const rawTopCelebId = (queryResult.matches[0].metadata as unknown as VectorMeta).celebrityId;
  const rerankChanged = rawTopCelebId !== top.celebrityId;

  const celebIds = Array.from(
    new Set([top.celebrityId, ...ranked.slice(1, 3).map((r) => r.celebrityId)]),
  );
  const celebs = await db
    .select({
      id: schema.celebrities.id,
      name: schema.celebrities.name,
      nameRu: schema.celebrities.nameRu,
      descriptionUz: schema.celebrities.descriptionUz,
      descriptionRu: schema.celebrities.descriptionRu,
      descriptionEn: schema.celebrities.descriptionEn,
      category: schema.celebrities.category,
    })
    .from(schema.celebrities)
    .where(inArray(schema.celebrities.id, celebIds));
  const celebById = new Map(celebs.map((c) => [c.id, c]));

  const topCeleb = celebById.get(top.celebrityId);
  if (!topCeleb) {
    await recordEvent({
      brandId: brand.id,
      eventType: "match_failed",
      metadata: { code: "celebrity_missing", celebrityId: top.celebrityId },
    });
    return NextResponse.json({ error: "celebrity_missing" }, { status: 503 });
  }

  const similarityPct = mapCosineToPct(top.cosine);
  const saved = await saveUserPhoto(payload.userPhotoBase64);

  const alternatives = ranked
    .slice(1, 3)
    .map((r) => {
      const c = celebById.get(r.celebrityId);
      if (!c) return null;
      return {
        celebrityId: r.celebrityId,
        celebrityPhotoId: r.celebrityPhotoId,
        name: c.name,
        nameRu: c.nameRu,
        photoUrl: `/api/files/${r.photoPath}`,
        similarity: mapCosineToPct(r.cosine),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const expiresAt = new Date(Date.now() + appConfig.userPhotoTtlHours * 3600_000);
  const storedAlternatives = alternatives.length
    ? alternatives.map((a) => ({
        celebrityId: a.celebrityId,
        celebrityPhotoId: a.celebrityPhotoId,
        similarity: a.similarity,
      }))
    : null;

  const [inserted] = await db
    .insert(schema.matchResults)
    .values({
      brandId: brand.id,
      celebrityId: top.celebrityId,
      celebrityPhotoId: top.celebrityPhotoId,
      similarity: similarityPct,
      userPhotoPath: saved.relativePath,
      alternatives: storedAlternatives,
      expiresAt,
    })
    .returning({ id: schema.matchResults.id });

  await recordEvent({
    brandId: brand.id,
    resultId: inserted.id,
    eventType: "match_completed",
    metadata: {
      celebrityId: top.celebrityId,
      celebrityPhotoId: top.celebrityPhotoId,
      similarity: similarityPct,
      userSex,
      userAge,
      faceQuality,
      detScore: payload.detScore,
      appliedGenderPenalty: applyGenderPenalty,
      rerankChanged,
      rawTopCelebId,
    },
  });

  return NextResponse.json({
    resultId: inserted.id,
    similarity: similarityPct,
    userPhotoUrl: `/api/files/${saved.relativePath}`,
    celebrity: {
      id: topCeleb.id,
      name: topCeleb.name,
      nameRu: topCeleb.nameRu,
      descriptionUz: topCeleb.descriptionUz,
      descriptionRu: topCeleb.descriptionRu,
      descriptionEn: topCeleb.descriptionEn,
      category: topCeleb.category,
      photoUrl: `/api/files/${top.photoPath}`,
    },
    alternatives,
  });
}

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { appConfig, mapCosineToPct } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { embedImage, embedImageMulti, MlError } from "@/lib/ml-client";
import { recordEvent } from "@/lib/analytics";
import { saveUserPhoto } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z
  .object({
    brandId: z.string().min(1).max(64),
    imageBase64: z.string().min(100).optional(),
    imagesBase64: z.array(z.string().min(100)).min(1).max(5).optional(),
  })
  .refine((v) => v.imageBase64 || v.imagesBase64, {
    message: "imageBase64 or imagesBase64 required",
  });

type CandidateRow = {
  photo_id: string;
  photo_path: string;
  id: string;
  name: string;
  name_ru: string | null;
  description_uz: string | null;
  description_ru: string | null;
  description_en: string | null;
  category: string | null;
  gender: "M" | "F" | null;
  age: number | null;
  distance: number;
};

type Candidate = CandidateRow & { cosine: number; score: number };

type RankContext = {
  userSex: "M" | "F" | null;
  userAge: number | null;
  faceQuality: "high" | "medium";
  applyGenderPenalty: boolean;
};

function rerank(rows: CandidateRow[], ctx: RankContext): Candidate[] {
  const {
    matchGenderPenalty,
    matchAgePenalty,
    matchTiebreakDelta,
  } = appConfig;

  // Dedupe: keep only the best-matching photo per celebrity. Preserves the
  // original distance order because `rows` came back sorted ascending.
  const byCeleb = new Map<string, CandidateRow>();
  for (const r of rows) {
    if (!byCeleb.has(r.id)) byCeleb.set(r.id, r);
  }

  const candidates: Candidate[] = Array.from(byCeleb.values()).map((r) => {
    const cosine = 1 - Number(r.distance);
    let score = cosine;
    if (ctx.applyGenderPenalty && ctx.userSex && r.gender && r.gender !== ctx.userSex) {
      score -= matchGenderPenalty;
    }
    if (ctx.userAge != null && r.age != null) {
      const delta = Math.min(Math.abs(ctx.userAge - r.age) / 30, 1);
      score -= matchAgePenalty * delta;
    }
    return { ...r, cosine, score };
  });

  candidates.sort((a, b) => b.score - a.score);

  // Soft tie-break: if the top candidate disagrees with the user's sex but
  // there's a same-sex alternative within `matchTiebreakDelta` cosine, promote
  // the same-sex one. Guards against noisy rankings when λ_gender alone isn't
  // enough to overcome a small cosine lead.
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

  const frames = payload.imagesBase64 ?? [payload.imageBase64!];

  let embedding: number[];
  let bestFrameBase64: string;
  let userSex: "M" | "F" | null = null;
  let userAge: number | null = null;
  let faceQuality: "high" | "medium" = "medium";
  try {
    if (frames.length > 1) {
      const multi = await embedImageMulti(frames, false);
      embedding = multi.embedding;
      bestFrameBase64 = frames[multi.best_frame_index] ?? frames[0];
      userSex = multi.sex;
      userAge = multi.age;
      faceQuality = multi.face_quality;
    } else {
      const single = await embedImage(frames[0], false);
      embedding = single.embedding;
      bestFrameBase64 = frames[0];
      userSex = single.sex;
      userAge = single.age;
      faceQuality = single.face_quality;
    }
  } catch (e) {
    const code = e instanceof MlError ? e.code : "internal";
    await recordEvent({
      brandId: brand.id,
      eventType: "match_failed",
      metadata: { code },
    });
    return NextResponse.json({ error: code }, { status: 422 });
  }

  const vecLiteral = `[${embedding.map((v) => v.toFixed(8)).join(",")}]`;
  const k = Math.max(10, Math.min(200, appConfig.matchRerankK));

  const matchRows = await db.execute<CandidateRow>(sql`
    SELECT cp.id AS photo_id,
           cp.photo_path,
           c.id, c.name, c.name_ru,
           c.description_uz, c.description_ru, c.description_en, c.category,
           c.gender, c.age,
           (cp.embedding <=> ${vecLiteral}::vector) AS distance
      FROM celebrity_photos cp
      JOIN celebrities c ON c.id = cp.celebrity_id
      WHERE c.active = true
      ORDER BY cp.embedding <=> ${vecLiteral}::vector
      LIMIT ${sql.raw(String(k))}
  `);

  if (!matchRows.length) {
    await recordEvent({
      brandId: brand.id,
      eventType: "match_failed",
      metadata: { code: "empty_db" },
    });
    return NextResponse.json({ error: "no_celebrities" }, { status: 503 });
  }

  // Skip gender penalty for children or low-quality detections — the buffalo_l
  // gender head is known to misfire on <16yo and blurry faces, and a false
  // penalty there does more harm than good.
  const applyGenderPenalty = userSex !== null && faceQuality === "high" && (userAge ?? 99) >= 16;

  const ranked = rerank(matchRows, { userSex, userAge, faceQuality, applyGenderPenalty });
  const top = ranked[0];
  const rawTop = matchRows[0];
  const rawTopCelebId = rawTop.id;
  const rerankChanged = rawTopCelebId !== top.id;

  const similarityPct = mapCosineToPct(top.cosine);

  const saved = await saveUserPhoto(bestFrameBase64);

  const alternatives = ranked.slice(1, 3).map((r) => ({
    celebrityId: r.id,
    celebrityPhotoId: r.photo_id,
    name: r.name,
    nameRu: r.name_ru,
    photoUrl: `/api/files/${r.photo_path}`,
    similarity: mapCosineToPct(r.cosine),
  }));

  const expiresAt = new Date(Date.now() + appConfig.userPhotoTtlHours * 3600_000);
  const [inserted] = await db
    .insert(schema.matchResults)
    .values({
      brandId: brand.id,
      celebrityId: top.id,
      celebrityPhotoId: top.photo_id,
      similarity: similarityPct,
      userPhotoPath: saved.relativePath,
      alternatives: alternatives.length ? alternatives : null,
      expiresAt,
    })
    .returning({ id: schema.matchResults.id });

  await recordEvent({
    brandId: brand.id,
    resultId: inserted.id,
    eventType: "match_completed",
    metadata: {
      celebrityId: top.id,
      celebrityPhotoId: top.photo_id,
      similarity: similarityPct,
      frameCount: frames.length,
      userSex,
      userAge,
      faceQuality,
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
      id: top.id,
      name: top.name,
      nameRu: top.name_ru,
      descriptionUz: top.description_uz,
      descriptionRu: top.description_ru,
      descriptionEn: top.description_en,
      category: top.category,
      photoUrl: `/api/files/${top.photo_path}`,
    },
    alternatives,
  });
}

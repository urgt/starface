import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { appConfig, mapCosineToPct } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { embedImage, MlError } from "@/lib/ml-client";
import { recordEvent } from "@/lib/analytics";
import { saveUserPhoto } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({
  brandId: z.string().min(1).max(64),
  imageBase64: z.string().min(100),
});

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

  let embedding: number[];
  try {
    const result = await embedImage(payload.imageBase64, false);
    embedding = result.embedding;
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

  const matchRows = await db.execute<{
    photo_id: string;
    photo_path: string;
    id: string;
    name: string;
    name_ru: string | null;
    description_uz: string | null;
    description_ru: string | null;
    description_en: string | null;
    category: string | null;
    distance: number;
  }>(sql`
    SELECT cp.id AS photo_id,
           cp.photo_path,
           c.id, c.name, c.name_ru,
           c.description_uz, c.description_ru, c.description_en, c.category,
           (cp.embedding <=> ${vecLiteral}::vector) AS distance
      FROM celebrity_photos cp
      JOIN celebrities c ON c.id = cp.celebrity_id
      WHERE c.active = true
      ORDER BY cp.embedding <=> ${vecLiteral}::vector
      LIMIT 1
  `);

  const top = matchRows[0];
  if (!top) {
    await recordEvent({
      brandId: brand.id,
      eventType: "match_failed",
      metadata: { code: "empty_db" },
    });
    return NextResponse.json({ error: "no_celebrities" }, { status: 503 });
  }

  const cosine = 1 - Number(top.distance);
  const similarityPct = mapCosineToPct(cosine);

  const saved = await saveUserPhoto(payload.imageBase64);

  const expiresAt = new Date(Date.now() + appConfig.userPhotoTtlHours * 3600_000);
  const [inserted] = await db
    .insert(schema.matchResults)
    .values({
      brandId: brand.id,
      celebrityId: top.id,
      celebrityPhotoId: top.photo_id,
      similarity: similarityPct,
      userPhotoPath: saved.relativePath,
      expiresAt,
    })
    .returning({ id: schema.matchResults.id });

  await recordEvent({
    brandId: brand.id,
    resultId: inserted.id,
    eventType: "match_completed",
    metadata: { celebrityId: top.id, celebrityPhotoId: top.photo_id, similarity: similarityPct },
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
  });
}

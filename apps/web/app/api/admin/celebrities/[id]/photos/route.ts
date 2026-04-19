import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { saveCelebrityPhoto, stripNullMeta } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMBEDDING_DIM = 512;

const photoSchema = z.object({
  imageBase64: z.string().min(100),
  imageExt: z.enum(["jpg", "jpeg", "png", "webp"]).default("jpg"),
  embedding: z.array(z.number()).length(EMBEDDING_DIM),
  detScore: z.number().min(0).max(1),
  faceQuality: z.enum(["high", "medium"]),
  blurScore: z.number().nullable().optional(),
  frontalScore: z.number().nullable().optional(),
  overallScore: z.number().nullable().optional(),
  source: z.string().max(32).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
});

const bodySchema = z.object({
  photos: z.array(photoSchema).min(1).max(10),
});

function base64ToUint8Array(input: string): Uint8Array {
  const cleaned = input.includes(",") ? input.split(",", 2)[1] : input;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [celeb] = await db
    .select({
      id: schema.celebrities.id,
      gender: schema.celebrities.gender,
      age: schema.celebrities.age,
      popularity: schema.celebrities.popularity,
    })
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "bad_request", detail: (e as Error).message },
      { status: 400 },
    );
  }

  const existingPrimary = await db
    .select({ id: schema.celebrityPhotos.id })
    .from(schema.celebrityPhotos)
    .where(
      and(
        eq(schema.celebrityPhotos.celebrityId, id),
        eq(schema.celebrityPhotos.isPrimary, true),
      ),
    )
    .limit(1);
  let hasPrimary = existingPrimary.length > 0;

  const { env } = getCloudflareContext();
  const results: Array<{
    status: "ok" | "error";
    photoId?: string;
    photoUrl?: string;
    faceQuality?: string;
    isPrimary?: boolean;
    error?: string;
  }> = [];
  const vectors: VectorizeVector[] = [];

  for (const p of payload.photos) {
    try {
      const bytes = base64ToUint8Array(p.imageBase64);
      const saved = await saveCelebrityPhoto(bytes, p.imageExt);
      const isPrimary = !hasPrimary;
      if (isPrimary) hasPrimary = true;

      const [photoRow] = await db
        .insert(schema.celebrityPhotos)
        .values({
          celebrityId: id,
          photoPath: saved.relativePath,
          isPrimary,
          faceQuality: p.faceQuality,
          detScore: p.detScore,
          blurScore: p.blurScore ?? null,
          frontalScore: p.frontalScore ?? null,
          overallScore: p.overallScore ?? null,
          source: p.source ?? null,
          sourceUrl: p.sourceUrl ?? null,
        })
        .returning({ id: schema.celebrityPhotos.id });

      vectors.push({
        id: photoRow.id,
        values: p.embedding,
        metadata: stripNullMeta({
          celebrityId: id,
          celebrityPhotoId: photoRow.id,
          photoPath: saved.relativePath,
          gender: celeb.gender,
          age: celeb.age,
          popularity: celeb.popularity,
          source: p.source,
          active: true,
        }),
      });

      results.push({
        status: "ok",
        photoId: photoRow.id,
        photoUrl: `/api/files/${saved.relativePath}`,
        faceQuality: p.faceQuality,
        isPrimary,
      });
    } catch (e) {
      results.push({ status: "error", error: (e as Error).message });
    }
  }

  if (vectors.length) await env.FACES.upsert(vectors);

  return NextResponse.json({ results });
}

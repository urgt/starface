import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { saveCelebrityPhoto, stripNullMeta } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMBEDDING_DIM = 512;
const MAX_CELEBRITIES_PER_BATCH = 25;
const MAX_PHOTOS_PER_CELEBRITY = 10;

const photoSchema = z.object({
  imageBase64: z.string().min(100),
  imageExt: z.enum(["jpg", "jpeg", "png", "webp"]).default("jpg"),
  embedding: z.array(z.number()).length(EMBEDDING_DIM),
  detScore: z.number().min(0).max(1),
  faceQuality: z.enum(["high", "medium"]),
  isPrimary: z.boolean().default(false),
  source: z.string().max(128).nullable().optional(),
  sourceUrl: z.string().url().max(2048).nullable().optional(),
  blurScore: z.number().nullable().optional(),
  frontalScore: z.number().nullable().optional(),
  overallScore: z.number().nullable().optional(),
});

const celebritySchema = z.object({
  externalId: z.string().max(64).nullable().optional(),
  name: z.string().min(1).max(200),
  nameRu: z.string().max(200).nullable().optional(),
  category: z.string().max(64).nullable().optional(),
  gender: z.enum(["M", "F"]).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  popularity: z.number().int().min(0).default(0),
  descriptionUz: z.string().nullable().optional(),
  descriptionRu: z.string().nullable().optional(),
  descriptionEn: z.string().nullable().optional(),
  attrsSource: z.string().max(64).nullable().optional(),
  photos: z.array(photoSchema).min(1).max(MAX_PHOTOS_PER_CELEBRITY),
});

const bodySchema = z.object({
  celebrities: z.array(celebritySchema).min(1).max(MAX_CELEBRITIES_PER_BATCH),
});

type EnrollResult = {
  inserted: number;
  updated: number;
  failed: Array<{ externalId: string | null; name: string; reason: string }>;
  ids: Array<{
    externalId: string | null;
    name: string;
    celebrityId: string;
    action: "inserted" | "updated";
  }>;
};

function base64ToUint8Array(input: string): Uint8Array {
  const cleaned = input.includes(",") ? input.split(",", 2)[1] : input;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function POST(req: Request) {
  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "bad_request", detail: (e as Error).message },
      { status: 400 },
    );
  }

  const { env } = getCloudflareContext();
  const result: EnrollResult = { inserted: 0, updated: 0, failed: [], ids: [] };

  const externalIds = payload.celebrities
    .map((c) => c.externalId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const names = payload.celebrities.map((c) => c.name);

  const existing = await db
    .select({
      id: schema.celebrities.id,
      wikidataId: schema.celebrities.wikidataId,
      name: schema.celebrities.name,
    })
    .from(schema.celebrities)
    .where(
      externalIds.length
        ? inArray(schema.celebrities.wikidataId, externalIds)
        : inArray(schema.celebrities.name, names),
    );

  const byWikidata = new Map(
    existing.filter((r) => r.wikidataId).map((r) => [r.wikidataId!, r.id]),
  );
  const byName = new Map(existing.map((r) => [r.name, r.id]));

  for (const input of payload.celebrities) {
    try {
      const existingId = input.externalId
        ? byWikidata.get(input.externalId) ?? byName.get(input.name) ?? null
        : byName.get(input.name) ?? null;

      let celebrityId: string;
      let action: "inserted" | "updated";
      if (existingId) {
        celebrityId = existingId;
        await db
          .update(schema.celebrities)
          .set({
            name: input.name,
            nameRu: input.nameRu ?? null,
            category: input.category ?? null,
            gender: input.gender ?? null,
            age: input.age ?? null,
            popularity: input.popularity,
            descriptionUz: input.descriptionUz ?? null,
            descriptionRu: input.descriptionRu ?? null,
            descriptionEn: input.descriptionEn ?? null,
            attrsSource: input.attrsSource ?? null,
            wikidataId: input.externalId ?? null,
          })
          .where(eq(schema.celebrities.id, celebrityId));
        result.updated += 1;
        action = "updated";
      } else {
        const [row] = await db
          .insert(schema.celebrities)
          .values({
            name: input.name,
            nameRu: input.nameRu ?? null,
            category: input.category ?? null,
            gender: input.gender ?? null,
            age: input.age ?? null,
            popularity: input.popularity,
            descriptionUz: input.descriptionUz ?? null,
            descriptionRu: input.descriptionRu ?? null,
            descriptionEn: input.descriptionEn ?? null,
            attrsSource: input.attrsSource ?? null,
            wikidataId: input.externalId ?? null,
          })
          .returning({ id: schema.celebrities.id });
        celebrityId = row.id;
        result.inserted += 1;
        action = "inserted";
      }
      result.ids.push({
        externalId: input.externalId ?? null,
        name: input.name,
        celebrityId,
        action,
      });

      const hasPrimaryRows = await db
        .select({ id: schema.celebrityPhotos.id })
        .from(schema.celebrityPhotos)
        .where(
          and(
            eq(schema.celebrityPhotos.celebrityId, celebrityId),
            eq(schema.celebrityPhotos.isPrimary, true),
          ),
        )
        .limit(1);
      let primaryAssigned = hasPrimaryRows.length > 0;

      const vectors: VectorizeVector[] = [];
      for (const p of input.photos) {
        const bytes = base64ToUint8Array(p.imageBase64);
        const saved = await saveCelebrityPhoto(bytes, p.imageExt);
        const isPrimary = p.isPrimary && !primaryAssigned;
        if (isPrimary) primaryAssigned = true;

        const [photoRow] = await db
          .insert(schema.celebrityPhotos)
          .values({
            celebrityId,
            photoPath: saved.relativePath,
            isPrimary,
            faceQuality: p.faceQuality,
            detScore: p.detScore,
            source: p.source ?? null,
            sourceUrl: p.sourceUrl ?? null,
            blurScore: p.blurScore ?? null,
            frontalScore: p.frontalScore ?? null,
            overallScore: p.overallScore ?? null,
          })
          .returning({ id: schema.celebrityPhotos.id });

        vectors.push({
          id: photoRow.id,
          values: p.embedding,
          metadata: stripNullMeta({
            celebrityId,
            celebrityPhotoId: photoRow.id,
            photoPath: saved.relativePath,
            gender: input.gender ?? null,
            age: input.age ?? null,
            popularity: input.popularity,
            active: true,
          }),
        });
      }

      if (vectors.length) await env.FACES.upsert(vectors);
    } catch (e) {
      result.failed.push({
        externalId: input.externalId ?? null,
        name: input.name,
        reason: (e as Error).message || "unknown",
      });
    }
  }

  return NextResponse.json(result);
}

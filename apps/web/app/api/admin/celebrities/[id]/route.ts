import { getCloudflareContext } from "@opennextjs/cloudflare";
import { asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { deleteStoredFile, stripNullMeta } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [celeb] = await db
    .select()
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const photos = await db
    .select({
      id: schema.celebrityPhotos.id,
      photoPath: schema.celebrityPhotos.photoPath,
      isPrimary: schema.celebrityPhotos.isPrimary,
      faceQuality: schema.celebrityPhotos.faceQuality,
      detScore: schema.celebrityPhotos.detScore,
      createdAt: schema.celebrityPhotos.createdAt,
    })
    .from(schema.celebrityPhotos)
    .where(eq(schema.celebrityPhotos.celebrityId, id))
    .orderBy(desc(schema.celebrityPhotos.isPrimary), asc(schema.celebrityPhotos.createdAt));

  return NextResponse.json({
    id: celeb.id,
    name: celeb.name,
    nameRu: celeb.nameRu,
    descriptionUz: celeb.descriptionUz,
    descriptionRu: celeb.descriptionRu,
    descriptionEn: celeb.descriptionEn,
    category: celeb.category,
    wikidataId: celeb.wikidataId,
    active: celeb.active,
    createdAt: celeb.createdAt,
    photos: photos.map((p) => ({
      id: p.id,
      photoUrl: `/api/files/${p.photoPath}`,
      photoPath: p.photoPath,
      isPrimary: p.isPrimary,
      faceQuality: p.faceQuality,
      detScore: p.detScore,
      createdAt: p.createdAt,
    })),
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameRu: z.string().max(200).nullable().optional(),
  descriptionUz: z.string().max(2000).nullable().optional(),
  descriptionRu: z.string().max(2000).nullable().optional(),
  descriptionEn: z.string().max(2000).nullable().optional(),
  category: z.enum(["uz", "cis", "world"]).nullable().optional(),
  wikidataId: z.string().max(64).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "bad_request", detail: (e as Error).message },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.nameRu !== undefined) updates.nameRu = body.nameRu;
  if (body.descriptionUz !== undefined) updates.descriptionUz = body.descriptionUz;
  if (body.descriptionRu !== undefined) updates.descriptionRu = body.descriptionRu;
  if (body.descriptionEn !== undefined) updates.descriptionEn = body.descriptionEn;
  if (body.category !== undefined) updates.category = body.category;
  if (body.wikidataId !== undefined) updates.wikidataId = body.wikidataId;
  if (body.active !== undefined) updates.active = body.active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  await db.update(schema.celebrities).set(updates).where(eq(schema.celebrities.id, id));

  if (body.active !== undefined) {
    const { env } = getCloudflareContext();
    const photos = await db
      .select({
        id: schema.celebrityPhotos.id,
        photoPath: schema.celebrityPhotos.photoPath,
      })
      .from(schema.celebrityPhotos)
      .where(eq(schema.celebrityPhotos.celebrityId, id));

    const [celeb] = await db
      .select({
        gender: schema.celebrities.gender,
        age: schema.celebrities.age,
        popularity: schema.celebrities.popularity,
      })
      .from(schema.celebrities)
      .where(eq(schema.celebrities.id, id))
      .limit(1);

    if (photos.length && celeb) {
      const existing = await env.FACES_V2.getByIds(photos.map((p) => p.id));
      const byId = new Map(existing.map((v) => [v.id, v]));
      const updated: VectorizeVector[] = [];
      for (const p of photos) {
        const v = byId.get(p.id);
        if (!v?.values) continue;
        updated.push({
          id: p.id,
          values: Array.from(v.values),
          metadata: stripNullMeta({
            celebrityId: id,
            celebrityPhotoId: p.id,
            photoPath: p.photoPath,
            gender: celeb.gender,
            age: celeb.age,
            popularity: celeb.popularity,
            active: body.active,
          }),
        });
      }
      if (updated.length) await env.FACES_V2.upsert(updated);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photos = await db
    .select({
      id: schema.celebrityPhotos.id,
      photoPath: schema.celebrityPhotos.photoPath,
    })
    .from(schema.celebrityPhotos)
    .where(eq(schema.celebrityPhotos.celebrityId, id));

  const deleted = await db
    .delete(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .returning({ id: schema.celebrities.id });

  if (deleted.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (photos.length) {
    const { env } = getCloudflareContext();
    await env.FACES_V2.deleteByIds(photos.map((p) => p.id));
    for (const p of photos) await deleteStoredFile(p.photoPath);
  }
  return NextResponse.json({ ok: true, deletedPhotos: photos.length });
}

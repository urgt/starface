import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { deleteStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

type PhotoRow = {
  id: string;
  photo_path: string;
  is_primary: boolean;
  face_quality: string | null;
  det_score: number | null;
  created_at: Date | null;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [celeb] = await db
    .select()
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const photos = await db.execute<PhotoRow>(sql`
    SELECT id, photo_path, is_primary, face_quality, det_score, created_at
      FROM celebrity_photos
      WHERE celebrity_id = ${id}
      ORDER BY is_primary DESC, created_at ASC
  `);

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
      photoUrl: `/api/files/${p.photo_path}`,
      photoPath: p.photo_path,
      isPrimary: p.is_primary,
      faceQuality: p.face_quality,
      detScore: p.det_score,
      createdAt: p.created_at,
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
    return NextResponse.json({ error: "bad_request", detail: (e as Error).message }, { status: 400 });
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
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photos = await db.execute<{ photo_path: string }>(sql`
    SELECT photo_path FROM celebrity_photos WHERE celebrity_id = ${id}
  `);

  // Cascade removes celebrity_photos rows; match_results.celebrity_id becomes NULL.
  const deleted = await db
    .delete(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .returning({ id: schema.celebrities.id });

  if (deleted.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  for (const p of photos) {
    await deleteStoredFile(p.photo_path);
  }
  return NextResponse.json({ ok: true, deletedPhotos: photos.length });
}

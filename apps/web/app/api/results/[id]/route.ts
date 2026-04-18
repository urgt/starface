import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [row] = await db
    .select({
      id: schema.matchResults.id,
      similarity: schema.matchResults.similarity,
      userPhotoPath: schema.matchResults.userPhotoPath,
      expiresAt: schema.matchResults.expiresAt,
      brandId: schema.matchResults.brandId,
      celebrityId: schema.celebrities.id,
      celebrityName: schema.celebrities.name,
      celebrityNameRu: schema.celebrities.nameRu,
      celebrityDescriptionUz: schema.celebrities.descriptionUz,
      celebrityDescriptionRu: schema.celebrities.descriptionRu,
      celebrityDescriptionEn: schema.celebrities.descriptionEn,
      celebrityPhotoPath: schema.celebrityPhotos.photoPath,
    })
    .from(schema.matchResults)
    .leftJoin(schema.celebrities, eq(schema.celebrities.id, schema.matchResults.celebrityId))
    .leftJoin(
      schema.celebrityPhotos,
      eq(schema.celebrityPhotos.id, schema.matchResults.celebrityPhotoId),
    )
    .where(eq(schema.matchResults.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  return NextResponse.json({
    id: row.id,
    similarity: row.similarity,
    userPhotoUrl: `/api/files/${row.userPhotoPath}`,
    brandId: row.brandId,
    celebrity: row.celebrityId
      ? {
          id: row.celebrityId,
          name: row.celebrityName,
          nameRu: row.celebrityNameRu,
          descriptionUz: row.celebrityDescriptionUz,
          descriptionRu: row.celebrityDescriptionRu,
          descriptionEn: row.celebrityDescriptionEn,
          photoUrl: row.celebrityPhotoPath ? `/api/files/${row.celebrityPhotoPath}` : null,
        }
      : null,
  });
}

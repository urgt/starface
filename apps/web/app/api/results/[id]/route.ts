import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  similarity: number;
  user_photo_path: string;
  expires_at: Date;
  brand_id: string | null;
  celebrity_id: string | null;
  celebrity_name: string | null;
  celebrity_name_ru: string | null;
  celebrity_description_uz: string | null;
  celebrity_description_ru: string | null;
  celebrity_description_en: string | null;
  celebrity_photo_path: string | null;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const rows = await db.execute<Row>(sql`
    SELECT m.id, m.similarity, m.user_photo_path, m.expires_at, m.brand_id,
           c.id AS celebrity_id,
           c.name AS celebrity_name,
           c.name_ru AS celebrity_name_ru,
           c.description_uz AS celebrity_description_uz,
           c.description_ru AS celebrity_description_ru,
           c.description_en AS celebrity_description_en,
           cp.photo_path AS celebrity_photo_path
      FROM match_results m
      LEFT JOIN celebrities c ON c.id = m.celebrity_id
      LEFT JOIN celebrity_photos cp ON cp.id = m.celebrity_photo_id
      WHERE m.id = ${id}
      LIMIT 1
  `);
  const row = rows[0];

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  return NextResponse.json({
    id: row.id,
    similarity: row.similarity,
    userPhotoUrl: `/api/files/${row.user_photo_path}`,
    brandId: row.brand_id,
    celebrity: row.celebrity_id
      ? {
          id: row.celebrity_id,
          name: row.celebrity_name,
          nameRu: row.celebrity_name_ru,
          descriptionUz: row.celebrity_description_uz,
          descriptionRu: row.celebrity_description_ru,
          descriptionEn: row.celebrity_description_en,
          photoUrl: row.celebrity_photo_path ? `/api/files/${row.celebrity_photo_path}` : null,
        }
      : null,
  });
}


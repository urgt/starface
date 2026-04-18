import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const rows = await db
    .select({
      id: schema.celebrities.id,
      name: schema.celebrities.name,
      nameRu: schema.celebrities.nameRu,
      photoPath: schema.celebrityPhotos.photoPath,
      popularity: schema.celebrities.popularity,
    })
    .from(schema.celebrities)
    .innerJoin(
      schema.celebrityPhotos,
      and(
        eq(schema.celebrityPhotos.celebrityId, schema.celebrities.id),
        eq(schema.celebrityPhotos.isPrimary, true),
      ),
    )
    .where(eq(schema.celebrities.active, true))
    .orderBy(desc(schema.celebrities.popularity), sql`random()`)
    .limit(24);

  return NextResponse.json(
    {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        nameRu: r.nameRu,
        photoUrl: `/api/files/${r.photoPath}`,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}

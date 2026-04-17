import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  id: string;
  name: string;
  name_ru: string | null;
  photo_path: string;
  popularity: number;
};

export async function GET() {
  const primary = (await db.execute(sql`
    SELECT c.id::text AS id,
           c.name,
           c.name_ru,
           cp.photo_path,
           c.popularity
      FROM celebrities c
      JOIN celebrity_photos cp
        ON cp.celebrity_id = c.id
       AND cp.is_primary = true
     WHERE c.active = true
     ORDER BY c.popularity DESC NULLS LAST, random()
     LIMIT 24
  `)) as unknown as Row[];

  let rows: Row[] = primary;
  const maxPopularity = rows.reduce((m, r) => Math.max(m, r.popularity ?? 0), 0);

  if (rows.length < 6 || maxPopularity === 0) {
    const fallback = (await db.execute(sql`
      SELECT c.id::text AS id,
             c.name,
             c.name_ru,
             cp.photo_path,
             c.popularity
        FROM celebrities c
        JOIN celebrity_photos cp
          ON cp.celebrity_id = c.id
         AND cp.is_primary = true
       WHERE c.active = true
       ORDER BY random()
       LIMIT 24
    `)) as unknown as Row[];
    if (fallback.length > rows.length) rows = fallback;
  }

  return NextResponse.json(
    {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        nameRu: r.name_ru,
        photoUrl: `/api/files/${r.photo_path}`,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}

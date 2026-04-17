import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;

  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM celebrity_photos WHERE celebrity_id = ${id} AND id = ${photoId} LIMIT 1
  `);
  if (!rows.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Two-step to avoid tripping the partial unique index during row-by-row evaluation.
  await db.execute(sql`
    UPDATE celebrity_photos SET is_primary = false
      WHERE celebrity_id = ${id} AND is_primary = true AND id <> ${photoId}
  `);
  await db.execute(sql`
    UPDATE celebrity_photos SET is_primary = true WHERE id = ${photoId}
  `);

  return NextResponse.json({ ok: true });
}

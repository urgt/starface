import { and, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;

  const [target] = await db
    .select({ id: schema.celebrityPhotos.id })
    .from(schema.celebrityPhotos)
    .where(
      and(eq(schema.celebrityPhotos.celebrityId, id), eq(schema.celebrityPhotos.id, photoId)),
    )
    .limit(1);
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db
    .update(schema.celebrityPhotos)
    .set({ isPrimary: false })
    .where(
      and(
        eq(schema.celebrityPhotos.celebrityId, id),
        eq(schema.celebrityPhotos.isPrimary, true),
        ne(schema.celebrityPhotos.id, photoId),
      ),
    );
  await db
    .update(schema.celebrityPhotos)
    .set({ isPrimary: true })
    .where(eq(schema.celebrityPhotos.id, photoId));

  return NextResponse.json({ ok: true });
}

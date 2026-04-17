import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { deleteStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;

  const photos = await db.execute<{
    id: string;
    photo_path: string;
    is_primary: boolean;
  }>(sql`
    SELECT id, photo_path, is_primary
      FROM celebrity_photos
      WHERE celebrity_id = ${id}
  `);

  if (!photos.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const target = photos.find((p) => p.id === photoId);
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (photos.length === 1) {
    return NextResponse.json(
      {
        error: "last_photo",
        message: "Cannot delete the only photo. Delete the celebrity instead or add another photo first.",
      },
      { status: 409 },
    );
  }

  await db.execute(sql`DELETE FROM celebrity_photos WHERE id = ${photoId}`);
  await deleteStoredFile(target.photo_path);

  if (target.is_primary) {
    const remaining = photos.filter((p) => p.id !== photoId);
    const promote = remaining[0];
    if (promote) {
      await db.execute(sql`UPDATE celebrity_photos SET is_primary = true WHERE id = ${promote.id}`);
    }
  }

  return NextResponse.json({ ok: true });
}

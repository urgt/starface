import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { deleteStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;

  const photos = await db
    .select({
      id: schema.celebrityPhotos.id,
      photoPath: schema.celebrityPhotos.photoPath,
      isPrimary: schema.celebrityPhotos.isPrimary,
    })
    .from(schema.celebrityPhotos)
    .where(eq(schema.celebrityPhotos.celebrityId, id));

  if (!photos.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const target = photos.find((p) => p.id === photoId);
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (photos.length === 1) {
    return NextResponse.json(
      {
        error: "last_photo",
        message:
          "Cannot delete the only photo. Delete the celebrity instead or add another photo first.",
      },
      { status: 409 },
    );
  }

  const { env } = getCloudflareContext();

  await db.delete(schema.celebrityPhotos).where(eq(schema.celebrityPhotos.id, photoId));
  await env.FACES.deleteByIds([photoId]);
  await deleteStoredFile(target.photoPath);

  if (target.isPrimary) {
    const remaining = photos.filter((p) => p.id !== photoId);
    const promote = remaining[0];
    if (promote) {
      await db
        .update(schema.celebrityPhotos)
        .set({ isPrimary: true })
        .where(eq(schema.celebrityPhotos.id, promote.id));
    }
  }

  return NextResponse.json({ ok: true });
}

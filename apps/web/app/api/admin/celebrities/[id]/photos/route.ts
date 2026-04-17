import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { embedImage, MlError } from "@/lib/ml-client";
import { saveCelebrityPhoto } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [celeb] = await db
    .select({ id: schema.celebrities.id })
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const form = await req.formData();
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return NextResponse.json({ error: "no_files" }, { status: 400 });

  const [{ count: existingCount }] = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM celebrity_photos WHERE celebrity_id = ${id}
  `);
  let hasPrimary = existingCount > 0
    ? Boolean(
        (
          await db.execute<{ exists: boolean }>(sql`
            SELECT EXISTS(SELECT 1 FROM celebrity_photos WHERE celebrity_id = ${id} AND is_primary = true) AS exists
          `)
        )[0]?.exists,
      )
    : false;

  const results: Array<{
    name: string;
    status: "ok" | "error";
    photoId?: string;
    photoUrl?: string;
    faceQuality?: string;
    isPrimary?: boolean;
    error?: string;
  }> = [];

  for (const file of files) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const base64 = buffer.toString("base64");
      const embed = await embedImage(base64, true);

      const saved = await saveCelebrityPhoto(buffer, ext);
      const isPrimary = !hasPrimary;
      if (isPrimary) hasPrimary = true;
      const vec = `[${embed.embedding.map((v) => v.toFixed(8)).join(",")}]`;

      const rows = await db.execute<{ id: string }>(sql`
        INSERT INTO celebrity_photos (celebrity_id, photo_path, embedding, is_primary, face_quality, det_score)
        VALUES (${id}, ${saved.relativePath}, ${vec}::vector, ${isPrimary}, ${embed.face_quality}, ${embed.det_score})
        RETURNING id
      `);

      results.push({
        name: file.name,
        status: "ok",
        photoId: rows[0]?.id,
        photoUrl: `/api/files/${saved.relativePath}`,
        faceQuality: embed.face_quality,
        isPrimary,
      });
    } catch (e) {
      const code = e instanceof MlError ? e.code : (e as Error).message;
      results.push({ name: file.name, status: "error", error: code });
    }
  }

  return NextResponse.json({ results });
}

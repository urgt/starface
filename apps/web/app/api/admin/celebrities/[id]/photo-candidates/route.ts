import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { findCandidatesForWikidata } from "@/lib/commons";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [celeb] = await db
    .select({ wikidataId: schema.celebrities.wikidataId })
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const photos = await db
    .select({
      id: schema.celebrityPhotos.id,
      isPrimary: schema.celebrityPhotos.isPrimary,
      sourceUrl: schema.celebrityPhotos.sourceUrl,
    })
    .from(schema.celebrityPhotos)
    .where(eq(schema.celebrityPhotos.celebrityId, id));

  const existingSourceUrls = new Set(
    photos.map((p) => p.sourceUrl).filter((u): u is string => Boolean(u)),
  );
  const primary = photos.find((p) => p.isPrimary) ?? photos[0] ?? null;

  let primaryEmbedding: number[] | null = null;
  if (primary) {
    try {
      const { env } = getCloudflareContext();
      const vectors = await env.FACES.getByIds([primary.id]);
      const values = vectors[0]?.values;
      if (values) {
        primaryEmbedding = Array.from(values as ArrayLike<number>);
      }
    } catch {
      primaryEmbedding = null;
    }
  }

  const currentPhotoCount = photos.length;

  if (!celeb.wikidataId) {
    return NextResponse.json({
      candidates: [],
      primaryEmbedding,
      currentPhotoCount,
    });
  }

  const all = await findCandidatesForWikidata(celeb.wikidataId);
  const candidates = all.filter((c) => !existingSourceUrls.has(c.sourceUrl));

  return NextResponse.json({ candidates, primaryEmbedding, currentPhotoCount });
}

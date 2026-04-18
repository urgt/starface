import { desc } from "drizzle-orm";
import Link from "next/link";

import { db, schema } from "@/lib/db";
import { CelebritiesList, type CelebrityRow } from "./CelebritiesList";

export const dynamic = "force-dynamic";

export default async function CelebritiesListPage() {
  const [celebs, photos] = await Promise.all([
    db.select().from(schema.celebrities).orderBy(desc(schema.celebrities.createdAt)).limit(500),
    db
      .select({
        id: schema.celebrityPhotos.id,
        celebrityId: schema.celebrityPhotos.celebrityId,
        photoPath: schema.celebrityPhotos.photoPath,
        isPrimary: schema.celebrityPhotos.isPrimary,
        faceQuality: schema.celebrityPhotos.faceQuality,
        createdAt: schema.celebrityPhotos.createdAt,
      })
      .from(schema.celebrityPhotos),
  ]);

  const photosByCeleb = new Map<string, typeof photos>();
  for (const p of photos) {
    const list = photosByCeleb.get(p.celebrityId) ?? [];
    list.push(p);
    photosByCeleb.set(p.celebrityId, list);
  }
  for (const list of photosByCeleb.values()) {
    list.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aT - bT;
    });
  }

  const celebrities: CelebrityRow[] = celebs.map((c) => {
    const ps = photosByCeleb.get(c.id) ?? [];
    const primary = ps.find((p) => p.isPrimary) ?? ps[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      nameRu: c.nameRu,
      category: c.category,
      descriptionUz: c.descriptionUz,
      descriptionRu: c.descriptionRu,
      descriptionEn: c.descriptionEn,
      wikidataId: c.wikidataId,
      active: c.active,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      photos: ps.map((p) => ({
        id: p.id,
        photoPath: p.photoPath,
        isPrimary: p.isPrimary,
        faceQuality: p.faceQuality,
      })),
      primaryPhotoPath: primary?.photoPath ?? null,
      photoCount: ps.length,
    };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Celebrities ({celebrities.length})</h1>
        <Link
          href="/admin/celebrities/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
        >
          + Enroll celebrity
        </Link>
      </div>
      <p className="text-sm text-neutral-500">
        Use the local seed CLI (<code>pnpm tsx scripts/seed/enroll.ts</code>) for bulk loads; this
        UI is for inspection and per-celebrity photo tweaks only.
      </p>
      <CelebritiesList celebrities={celebrities} />
    </div>
  );
}

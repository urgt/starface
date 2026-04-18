import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db, schema } from "@/lib/db";
import { CelebrityPage } from "./CelebrityPage";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [celeb] = await db
    .select()
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) notFound();

  const photos = await db
    .select({
      id: schema.celebrityPhotos.id,
      photoPath: schema.celebrityPhotos.photoPath,
      isPrimary: schema.celebrityPhotos.isPrimary,
      faceQuality: schema.celebrityPhotos.faceQuality,
      detScore: schema.celebrityPhotos.detScore,
      createdAt: schema.celebrityPhotos.createdAt,
    })
    .from(schema.celebrityPhotos)
    .where(eq(schema.celebrityPhotos.celebrityId, id))
    .orderBy(desc(schema.celebrityPhotos.isPrimary), asc(schema.celebrityPhotos.createdAt));

  return (
    <div className="space-y-4">
      <Link href="/admin/celebrities" className="text-sm text-neutral-500 hover:underline">
        ← Back to list
      </Link>
      <CelebrityPage
        initial={{
          id: celeb.id,
          name: celeb.name,
          nameRu: celeb.nameRu,
          category: celeb.category,
          descriptionUz: celeb.descriptionUz,
          descriptionRu: celeb.descriptionRu,
          descriptionEn: celeb.descriptionEn,
          wikidataId: celeb.wikidataId,
          active: Boolean(celeb.active),
          createdAt: celeb.createdAt ? celeb.createdAt.toISOString() : null,
          photos: photos.map((p) => ({
            id: p.id,
            photoUrl: `/api/files/${p.photoPath}`,
            photoPath: p.photoPath,
            isPrimary: p.isPrimary,
            faceQuality: p.faceQuality,
            detScore: p.detScore,
          })),
        }}
      />
    </div>
  );
}

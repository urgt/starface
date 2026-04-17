import Link from "next/link";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { CelebritiesList, type CelebrityRow } from "./CelebritiesList";

export const dynamic = "force-dynamic";

type PhotoMini = { id: string; photoPath: string; isPrimary: boolean; faceQuality: string | null };

type Row = {
  id: string;
  name: string;
  name_ru: string | null;
  category: string | null;
  description_uz: string | null;
  description_ru: string | null;
  description_en: string | null;
  wikidata_id: string | null;
  active: boolean | null;
  created_at: Date | string | null;
  photos: PhotoMini[];
  primary_photo: string | null;
  photo_count: number;
};

export default async function CelebritiesListPage() {
  const rows = await db.execute<Row>(sql`
    SELECT
      c.id, c.name, c.name_ru, c.category,
      c.description_uz, c.description_ru, c.description_en,
      c.wikidata_id, c.active, c.created_at,
      (
        SELECT json_agg(json_build_object(
          'id', cp.id,
          'photoPath', cp.photo_path,
          'isPrimary', cp.is_primary,
          'faceQuality', cp.face_quality
        ) ORDER BY cp.is_primary DESC, cp.created_at ASC)
        FROM celebrity_photos cp WHERE cp.celebrity_id = c.id
      ) AS photos,
      (SELECT cp.photo_path FROM celebrity_photos cp
         WHERE cp.celebrity_id = c.id AND cp.is_primary = true LIMIT 1) AS primary_photo,
      (SELECT count(*)::int FROM celebrity_photos cp WHERE cp.celebrity_id = c.id) AS photo_count
    FROM celebrities c
    ORDER BY c.created_at DESC
    LIMIT 500
  `);

  const celebrities: CelebrityRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameRu: r.name_ru,
    category: r.category,
    descriptionUz: r.description_uz,
    descriptionRu: r.description_ru,
    descriptionEn: r.description_en,
    wikidataId: r.wikidata_id,
    active: r.active,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    photos: r.photos ?? [],
    primaryPhotoPath: r.primary_photo,
    photoCount: r.photo_count,
  }));

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
        Click a card to see full info and manage photos. Use the enroll CLI (<code>./scripts/seed.sh</code>) for bulk loads.
      </p>
      <CelebritiesList celebrities={celebrities} />
    </div>
  );
}

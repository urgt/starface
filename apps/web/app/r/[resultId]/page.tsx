import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";

import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { brandThemeFromRow, DEFAULT_BRAND_THEME } from "@/lib/brand-theme";
import { ResultCard, type ResultCardData } from "@/components/result/ResultCard";

export const dynamic = "force-dynamic";

type SearchParams = { brand?: string; lang?: string };

type ResultRow = {
  id: string;
  similarity: number;
  user_photo_path: string;
  expires_at: Date;
  brand_id: string | null;
  celebrity: {
    id: string;
    name: string | null;
    nameRu: string | null;
    descriptionUz: string | null;
    descriptionRu: string | null;
    descriptionEn: string | null;
    photoPath: string | null;
  } | null;
};

async function loadResult(resultId: string): Promise<ResultRow | null> {
  const rows = await db.execute<{
    id: string;
    similarity: number;
    user_photo_path: string;
    expires_at: Date;
    brand_id: string | null;
    celebrity_id: string | null;
    celebrity_name: string | null;
    celebrity_name_ru: string | null;
    celebrity_description_uz: string | null;
    celebrity_description_ru: string | null;
    celebrity_description_en: string | null;
    celebrity_photo_path: string | null;
  }>(sql`
    SELECT m.id, m.similarity, m.user_photo_path, m.expires_at, m.brand_id,
           c.id AS celebrity_id,
           c.name AS celebrity_name,
           c.name_ru AS celebrity_name_ru,
           c.description_uz AS celebrity_description_uz,
           c.description_ru AS celebrity_description_ru,
           c.description_en AS celebrity_description_en,
           cp.photo_path AS celebrity_photo_path
      FROM match_results m
      LEFT JOIN celebrities c ON c.id = m.celebrity_id
      LEFT JOIN celebrity_photos cp ON cp.id = m.celebrity_photo_id
      WHERE m.id = ${resultId}
      LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    similarity: row.similarity,
    user_photo_path: row.user_photo_path,
    expires_at: new Date(row.expires_at),
    brand_id: row.brand_id,
    celebrity: row.celebrity_id
      ? {
          id: row.celebrity_id,
          name: row.celebrity_name,
          nameRu: row.celebrity_name_ru,
          descriptionUz: row.celebrity_description_uz,
          descriptionRu: row.celebrity_description_ru,
          descriptionEn: row.celebrity_description_en,
          photoPath: row.celebrity_photo_path,
        }
      : null,
  };
}

async function loadBrand(brandId: string | null | undefined) {
  if (!brandId) return null;
  const [brand] = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);
  return brand ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ resultId: string }>;
}): Promise<Metadata> {
  const { resultId } = await params;
  const result = await loadResult(resultId);
  if (!result) return { title: "StarFace UZ" };
  const celebName = result.celebrity?.name ?? "?";
  const title = `${celebName} — ${result.similarity}% сходства · StarFace UZ`;
  // Server-rendered composite (selfie + celeb + %) — looks much better in
  // Telegram/WhatsApp previews than just the raw selfie.
  const imageUrl = `${appConfig.appUrl}/r/${resultId}/og-image`;
  return {
    title,
    openGraph: { title, images: [{ url: imageUrl, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [imageUrl] },
  };
}

export default async function ResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ resultId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ resultId }, sp] = await Promise.all([params, searchParams]);
  const result = await loadResult(resultId);
  if (!result) notFound();

  const locale: Locale = sp.lang === "ru" ? "ru" : "uz";
  const dict = t(locale);

  if (result.expires_at.getTime() < Date.now()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-center">
        <p className="text-xl text-neutral-300">{dict.resultExpired}</p>
      </div>
    );
  }

  const brandRow = await loadBrand(result.brand_id ?? sp.brand);
  const brand = brandRow ? brandThemeFromRow(brandRow) : DEFAULT_BRAND_THEME;

  const shareUrl = `${appConfig.appUrl}/r/${result.id}${
    brand.id !== "__default" ? `?brand=${encodeURIComponent(brand.id)}&lang=${locale}` : `?lang=${locale}`
  }`;

  const data: ResultCardData = {
    resultId: result.id,
    similarity: result.similarity,
    userPhotoUrl: `/api/files/${result.user_photo_path}`,
    celebrity: {
      name: result.celebrity?.name ?? "?",
      nameRu: result.celebrity?.nameRu ?? null,
      descriptionUz: result.celebrity?.descriptionUz ?? null,
      descriptionRu: result.celebrity?.descriptionRu ?? null,
      descriptionEn: result.celebrity?.descriptionEn ?? null,
      photoUrl: result.celebrity?.photoPath ? `/api/files/${result.celebrity.photoPath}` : null,
    },
    shareUrl,
  };

  return <ResultCard data={data} brand={brand} locale={locale} />;
}

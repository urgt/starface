import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";

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
  const [row] = await db
    .select({
      id: schema.matchResults.id,
      similarity: schema.matchResults.similarity,
      userPhotoPath: schema.matchResults.userPhotoPath,
      expiresAt: schema.matchResults.expiresAt,
      brandId: schema.matchResults.brandId,
      celebrityId: schema.celebrities.id,
      celebrityName: schema.celebrities.name,
      celebrityNameRu: schema.celebrities.nameRu,
      celebrityDescriptionUz: schema.celebrities.descriptionUz,
      celebrityDescriptionRu: schema.celebrities.descriptionRu,
      celebrityDescriptionEn: schema.celebrities.descriptionEn,
      celebrityPhotoPath: schema.celebrityPhotos.photoPath,
    })
    .from(schema.matchResults)
    .leftJoin(schema.celebrities, eq(schema.celebrities.id, schema.matchResults.celebrityId))
    .leftJoin(
      schema.celebrityPhotos,
      eq(schema.celebrityPhotos.id, schema.matchResults.celebrityPhotoId),
    )
    .where(eq(schema.matchResults.id, resultId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    similarity: row.similarity,
    user_photo_path: row.userPhotoPath,
    expires_at: new Date(row.expiresAt),
    brand_id: row.brandId,
    celebrity: row.celebrityId
      ? {
          id: row.celebrityId,
          name: row.celebrityName,
          nameRu: row.celebrityNameRu,
          descriptionUz: row.celebrityDescriptionUz,
          descriptionRu: row.celebrityDescriptionRu,
          descriptionEn: row.celebrityDescriptionEn,
          photoPath: row.celebrityPhotoPath,
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-brand-gradient p-6 font-brand">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/40 p-8 text-center text-white shadow-2xl backdrop-blur">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand-primary)]/20 text-2xl">
            ⏱
          </div>
          <h1 className="text-2xl font-bold">{dict.resultExpired}</h1>
          <p className="mt-2 text-sm text-white/70">{dict.resultNotFoundBody}</p>
        </div>
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

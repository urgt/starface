import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";

import { ResultShareClient } from "./ResultShareClient";
import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

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
  const imageUrl = `${appConfig.appUrl}/api/files/${result.user_photo_path}`;
  return {
    title,
    openGraph: { title, images: [imageUrl] },
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

  const brand = await loadBrand(result.brand_id ?? sp.brand);
  const celebName =
    locale === "ru"
      ? result.celebrity?.nameRu ?? result.celebrity?.name ?? ""
      : result.celebrity?.name ?? "";
  const descUz = result.celebrity?.descriptionUz ?? null;
  const descRu = result.celebrity?.descriptionRu ?? null;
  const descEn = result.celebrity?.descriptionEn ?? null;
  const description =
    locale === "ru" ? descRu || descUz || descEn : descUz || descRu || descEn;

  const cssVars = {
    "--brand-primary": brand?.primaryColor ?? "#FF5E3A",
    "--brand-accent": brand?.accentColor ?? "#111111",
  } as React.CSSProperties;

  const shareUrl = `${appConfig.appUrl}/r/${result.id}${
    brand ? `?brand=${encodeURIComponent(brand.id)}&lang=${locale}` : `?lang=${locale}`
  }`;
  const shareText = `${celebName} — ${result.similarity}% ${dict.similarity} · StarFace UZ`;

  const promoText =
    brand &&
    (locale === "ru" ? brand.promoTextRu ?? null : brand.promoTextUz ?? null);

  return (
    <div className="min-h-screen bg-neutral-950 px-4 py-8" style={cssVars}>
      <div className="mx-auto max-w-md space-y-6">
        {brand && (
          <div className="flex items-center justify-center">
            {brand.logoPath ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/files/${brand.logoPath}`}
                alt={dict.brandLogoAlt}
                className="h-14 max-w-[200px] object-contain"
              />
            ) : (
              <p className="text-sm uppercase tracking-widest text-neutral-500">{brand.name}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/files/${result.user_photo_path}`}
            alt="you"
            className="aspect-square w-full object-contain scale-x-[-1]"
          />
          {result.celebrity?.photoPath && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/files/${result.celebrity.photoPath}`}
              alt={celebName}
              className="aspect-square w-full object-contain"
            />
          )}
        </div>

        <div className="space-y-2 text-center">
          <p className="text-sm uppercase tracking-widest text-neutral-500">{celebName}</p>
          <p className="text-6xl font-black text-[var(--brand-primary)]">
            {result.similarity}%
          </p>
          <p className="text-neutral-400">{dict.similarity}</p>
        </div>

        {description && (
          <p className="text-center text-lg leading-snug text-neutral-200">{description}</p>
        )}

        {brand?.promoCode && (
          <div className="rounded-2xl border border-dashed border-[var(--brand-primary)]/70 bg-[var(--brand-primary)]/10 p-6 text-center">
            <p className="text-xs uppercase tracking-widest text-neutral-400">{dict.promo}</p>
            {promoText && <p className="mt-1 text-neutral-200">{promoText}</p>}
            <p className="mt-3 text-3xl font-black tracking-widest text-[var(--brand-primary)]">
              {brand.promoCode}
            </p>
          </div>
        )}

        <ResultShareClient
          resultId={result.id}
          brandId={brand?.id ?? null}
          shareUrl={shareUrl}
          shareText={shareText}
          dict={{
            share: dict.share,
            telegram: dict.shareTelegram,
            copy: dict.copyLink,
            copied: dict.linkCopied,
          }}
        />
      </div>
    </div>
  );
}

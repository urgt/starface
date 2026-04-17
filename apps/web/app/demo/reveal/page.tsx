import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { brandThemeFromRow, DEFAULT_BRAND_THEME } from "@/lib/brand-theme";
import type { Locale } from "@/lib/i18n";
import { DemoRevealClient } from "./DemoRevealClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "StarFace — demo reveal",
  robots: { index: false, follow: false },
};

type SearchParams = { id?: string; brand?: string; lang?: string };

/**
 * QA / stakeholder page: renders the kiosk RevealScreen against a real
 * match_result row, skipping the camera + gesture + /api/match roundtrip.
 * Pass `?id=<matchResultId>` to pin a specific result; otherwise uses the
 * latest one.
 */
export default async function DemoRevealPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const locale: Locale = sp.lang === "uz" ? "uz" : "ru";

  let brand = DEFAULT_BRAND_THEME;
  if (sp.brand) {
    const [row] = await db
      .select()
      .from(schema.brands)
      .where(eq(schema.brands.id, sp.brand))
      .limit(1);
    if (row) brand = brandThemeFromRow(row);
  }

  const rows = sp.id
    ? await db
        .select()
        .from(schema.matchResults)
        .where(eq(schema.matchResults.id, sp.id))
        .limit(1)
    : await db
        .select()
        .from(schema.matchResults)
        .orderBy(desc(schema.matchResults.createdAt))
        .limit(1);
  const result = rows[0];
  if (!result) notFound();

  const [celeb] = await db
    .select()
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, result.celebrityId!))
    .limit(1);
  if (!celeb) notFound();

  const [celebPhoto] = result.celebrityPhotoId
    ? await db
        .select()
        .from(schema.celebrityPhotos)
        .where(eq(schema.celebrityPhotos.id, result.celebrityPhotoId))
        .limit(1)
    : [];

  type Alt = {
    celebrityId: string;
    celebrityPhotoId: string;
    name: string;
    nameRu: string | null;
    photoUrl: string;
    similarity: number;
  };
  const alternatives = (result.alternatives as Alt[] | null) ?? [];

  const payload = {
    resultId: result.id,
    similarity: result.similarity,
    userPhotoUrl: `/api/files/${result.userPhotoPath}`,
    celebrity: {
      name: celeb.name,
      nameRu: celeb.nameRu,
      descriptionUz: celeb.descriptionUz,
      descriptionRu: celeb.descriptionRu,
      descriptionEn: celeb.descriptionEn,
      photoUrl: celebPhoto ? `/api/files/${celebPhoto.photoPath}` : "",
    },
    alternatives,
  };

  return (
    <DemoRevealClient
      payload={payload}
      locale={locale}
      brand={brand}
      appUrl={appConfig.appUrl}
    />
  );
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { KioskApp } from "@/components/kiosk/KioskApp";
import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { brandThemeFromRow } from "@/lib/brand-theme";

export const dynamic = "force-dynamic";

type SearchParams = { brand?: string };

export default async function KioskPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { brand: brandId } = await searchParams;
  if (!brandId) notFound();

  const [brand] = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);

  if (!brand || !brand.active) notFound();

  const theme = brandThemeFromRow(brand);

  return <KioskApp brand={theme} appUrl={appConfig.appUrl} />;
}

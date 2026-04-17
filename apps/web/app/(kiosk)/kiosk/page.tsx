import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { KioskApp } from "@/components/kiosk/KioskApp";
import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";

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

  return (
    <KioskApp
      brand={{
        id: brand.id,
        name: brand.name,
        logoUrl: brand.logoPath ? `/api/files/${brand.logoPath}` : null,
        primaryColor: brand.primaryColor ?? "#FF5E3A",
        accentColor: brand.accentColor ?? "#111111",
        idleTextUz: brand.idleTextUz ?? null,
        idleTextRu: brand.idleTextRu ?? null,
      }}
      appUrl={appConfig.appUrl}
    />
  );
}

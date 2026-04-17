import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = { t?: string };

export default async function BrandAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ brandId }, { t: token }] = await Promise.all([params, searchParams]);

  const [brand] = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, brandId))
    .limit(1);

  if (!brand || !token || brand.analyticsToken !== token) notFound();

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-8 text-neutral-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <p className="text-sm text-neutral-500">Analytics for</p>
          <h1 className="text-2xl font-bold">{brand.name}</h1>
        </div>
        <AnalyticsDashboard brandId={brand.id} />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import { ResultCard, type ResultCardData } from "@/components/result/ResultCard";
import { brandThemeFromRow, DEFAULT_BRAND_THEME } from "@/lib/brand-theme";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "StarFace — пример результата",
  robots: { index: false, follow: false },
};

type SearchParams = { brand?: string; lang?: string };

const MOCK: Omit<ResultCardData, "shareUrl" | "resultId"> = {
  similarity: 87,
  userPhotoUrl: "/demo/user.svg",
  celebrity: {
    name: "Dilnura Qudratova",
    nameRu: "Дильнура Кудратова",
    descriptionUz:
      "Mashhur o'zbek aktrisa va taniqli televizion mehmondo'st. Uning tabassumi va xarizmasi milliy kino yulduzlari orasida ajralib turadi.",
    descriptionRu:
      "Известная узбекская актриса и популярная телеведущая. Её обаяние и харизма выделяют её среди звёзд национального кино.",
    descriptionEn:
      "A renowned Uzbek actress and popular TV host whose charisma and smile stand out among the country's film icons.",
    photoUrl: "/demo/celebrity.svg",
  },
};

export default async function DemoResultPage({
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

  const data: ResultCardData = {
    ...MOCK,
    resultId: null,
    shareUrl: null,
    demo: true,
  };

  return <ResultCard data={data} brand={brand} locale={locale} />;
}

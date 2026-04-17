import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { generateDescriptions } from "@/lib/description-generator";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [celeb] = await db
    .select()
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const g = await generateDescriptions({
      name: celeb.name,
      nameRu: celeb.nameRu,
      category: celeb.category,
      descriptionRu: celeb.descriptionRu,
      descriptionEn: celeb.descriptionEn,
      wikidataId: celeb.wikidataId,
    });
    if (!g.uz && !g.ru && !g.en) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 });
    }
    await db.execute(sql`
      UPDATE celebrities
        SET description_uz = COALESCE(NULLIF(${g.uz},''), description_uz),
            description_ru = COALESCE(NULLIF(${g.ru},''), description_ru),
            description_en = COALESCE(NULLIF(${g.en},''), description_en)
        WHERE id = ${id}
    `);
    return NextResponse.json({
      ok: true,
      uz: g.uz,
      ru: g.ru,
      en: g.en,
      sources: g.sources,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

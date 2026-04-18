import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const missingDescriptions = url.searchParams.get("missingDescriptions") === "1";
  const category = url.searchParams.get("category");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "5000"), 5000);

  const filters = [];
  if (category) filters.push(eq(schema.celebrities.category, category));
  if (missingDescriptions) {
    filters.push(
      or(
        isNull(schema.celebrities.descriptionUz),
        eq(schema.celebrities.descriptionUz, ""),
        isNull(schema.celebrities.descriptionRu),
        eq(schema.celebrities.descriptionRu, ""),
        isNull(schema.celebrities.descriptionEn),
        eq(schema.celebrities.descriptionEn, ""),
      )!,
    );
  }

  const rows = await db
    .select({
      id: schema.celebrities.id,
      name: schema.celebrities.name,
      nameRu: schema.celebrities.nameRu,
      category: schema.celebrities.category,
      wikidataId: schema.celebrities.wikidataId,
      descriptionUz: schema.celebrities.descriptionUz,
      descriptionRu: schema.celebrities.descriptionRu,
      descriptionEn: schema.celebrities.descriptionEn,
      active: schema.celebrities.active,
      createdAt: schema.celebrities.createdAt,
    })
    .from(schema.celebrities)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(schema.celebrities.popularity), asc(schema.celebrities.createdAt))
    .limit(limit);

  return NextResponse.json({ items: rows });
}

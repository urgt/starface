import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [brand] = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.id, id))
    .limit(1);

  if (!brand || !brand.active) {
    return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: brand.id,
    name: brand.name,
    logoUrl: brand.logoPath ? `/api/files/${brand.logoPath}` : null,
    primaryColor: brand.primaryColor,
    accentColor: brand.accentColor,
    idleTextUz: brand.idleTextUz,
    idleTextRu: brand.idleTextRu,
    promoCode: brand.promoCode,
    promoTextUz: brand.promoTextUz,
    promoTextRu: brand.promoTextRu,
  });
}

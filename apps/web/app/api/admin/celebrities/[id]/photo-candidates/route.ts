import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { findCandidatesForWikidata } from "@/lib/commons";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [celeb] = await db
    .select({ wikidataId: schema.celebrities.wikidataId })
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!celeb.wikidataId) return NextResponse.json({ candidates: [] });
  const candidates = await findCandidatesForWikidata(celeb.wikidataId);
  return NextResponse.json({ candidates });
}

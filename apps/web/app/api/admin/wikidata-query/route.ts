import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { PRESETS } from "@/lib/wikidata-presets";
import { runSparql } from "@/lib/wikidata-query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OVERFETCH_FACTOR = 3;
const OVERFETCH_HARD_CAP = 1000;
const USER_LIMIT_MAX = 500;
const D1_IN_CHUNK = 80;

const bodySchema = z
  .object({
    preset: z.string().optional(),
    sparql: z.string().max(8000).optional(),
    limit: z.number().int().min(1).max(USER_LIMIT_MAX).default(100),
  })
  .refine((v) => v.preset || v.sparql, { message: "preset or sparql required" });

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "bad_request", detail: (e as Error).message },
      { status: 400 },
    );
  }

  let query: string;
  if (body.preset) {
    const preset = PRESETS.find((p) => p.id === body.preset);
    if (!preset) return NextResponse.json({ error: "unknown_preset" }, { status: 400 });
    query = preset.sparql;
  } else {
    query = body.sparql!;
  }

  const overfetchLimit = Math.min(body.limit * OVERFETCH_FACTOR, OVERFETCH_HARD_CAP);

  let raw;
  try {
    raw = await runSparql(query, overfetchLimit);
  } catch (e) {
    return NextResponse.json(
      { error: "sparql_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }

  const fetchedTotal = raw.length;

  let skippedExisting = 0;
  let filtered = raw;
  if (raw.length) {
    const qids = raw.map((c) => c.qid);
    const existingSet = new Set<string>();
    for (let i = 0; i < qids.length; i += D1_IN_CHUNK) {
      const chunk = qids.slice(i, i + D1_IN_CHUNK);
      const rows = await db
        .select({ wikidataId: schema.celebrities.wikidataId })
        .from(schema.celebrities)
        .where(inArray(schema.celebrities.wikidataId, chunk));
      for (const r of rows) if (r.wikidataId) existingSet.add(r.wikidataId);
    }
    filtered = raw.filter((c) => !existingSet.has(c.qid));
    skippedExisting = raw.length - filtered.length;
  }

  const candidates = filtered.slice(0, body.limit);

  return NextResponse.json({
    candidates,
    fetchedTotal,
    skippedExisting,
    requested: body.limit,
  });
}

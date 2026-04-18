import { NextResponse } from "next/server";
import { z } from "zod";

import { PRESETS } from "@/lib/wikidata-presets";
import { runSparql } from "@/lib/wikidata-query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z
  .object({
    preset: z.string().optional(),
    sparql: z.string().max(8000).optional(),
    limit: z.number().int().min(1).max(500).default(100),
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

  try {
    const candidates = await runSparql(query, body.limit);
    return NextResponse.json({ candidates });
  } catch (e) {
    return NextResponse.json(
      { error: "sparql_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
}

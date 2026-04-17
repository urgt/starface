import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const bodySchema = z.object({
  category: z.enum(["uz", "cis", "world", "all"]).default("all"),
  limit: z.number().int().positive().max(10000).optional(),
  skipFetch: z.boolean().optional(),
  skipEnroll: z.boolean().optional(),
  skipGenerate: z.boolean().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "bad_request", detail: (e as Error).message }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const mlUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  const upstream = await fetch(`${mlUrl}/ml/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: body.category,
      limit: body.limit ?? null,
      skip_fetch: body.skipFetch ?? false,
      skip_enroll: body.skipEnroll ?? false,
      skip_generate: body.skipGenerate ?? false,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: "ml_upstream_failed", status: upstream.status, detail: text.slice(0, 500) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

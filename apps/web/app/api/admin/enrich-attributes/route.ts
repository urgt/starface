import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  limit: z.number().int().min(1).max(5000).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "bad_request", detail: (e as Error).message }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const mlUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  const upstream = await fetch(`${mlUrl}/ml/enrich-attributes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: body.limit ?? null }),
    // ~200ms per celeb × up to ~500 celebs ≈ 100s. Give ML a wide ceiling.
    signal: AbortSignal.timeout(280_000),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

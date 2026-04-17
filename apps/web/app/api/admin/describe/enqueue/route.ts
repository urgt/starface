import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  onlyEmpty: z.boolean().optional(),
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
  if (!body.ids?.length && !body.all) {
    return new Response(JSON.stringify({ error: "ids_or_all_required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const mlUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  const upstream = await fetch(`${mlUrl}/ml/describe/enqueue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ids: body.ids,
      all: body.all ?? false,
      only_empty: body.onlyEmpty ?? false,
    }),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function GET() {
  const mlUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  const upstream = await fetch(`${mlUrl}/ml/describe/events`, {
    cache: "no-store",
    headers: { Accept: "text/event-stream" },
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: "ml_upstream_failed", status: upstream.status, detail: text.slice(0, 300) }),
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

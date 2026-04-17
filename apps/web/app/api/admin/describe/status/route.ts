export const dynamic = "force-dynamic";

export async function GET() {
  const mlUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
  const upstream = await fetch(`${mlUrl}/ml/describe/status`, { cache: "no-store" });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

import { NextResponse } from "next/server";

const KNOWN_CODES = new Set([
  "no_face",
  "multiple_faces",
  "low_quality",
  "detector_load_failed",
  "model_load_failed",
  "internal",
]);

function requireEnv(env: CloudflareEnv): { url: string; secret: string } {
  const url = env.MODAL_EMBED_URL;
  const secret = env.MODAL_SHARED_SECRET;
  if (!url || !secret) {
    throw new Error("MODAL_EMBED_URL / MODAL_SHARED_SECRET not configured");
  }
  return { url: url.replace(/\/$/, ""), secret };
}

export async function proxyEmbed(
  req: Request,
  env: CloudflareEnv,
  path: "/embed" | "/embed/burst",
): Promise<Response> {
  const { url, secret } = requireEnv(env);

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const upstream = await fetch(`${url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      // Let fetch forward the multipart body as-is; keeping the original
      // Content-Type header preserves the multipart boundary.
      "Content-Type": ct,
    },
    body: req.body,
    // @ts-expect-error Cloudflare Workers fetch supports `duplex: "half"` to
    // stream the request body through; it's not yet in lib.dom.d.ts.
    duplex: "half",
    signal: AbortSignal.timeout(25_000),
  });

  if (upstream.ok) {
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // FastAPI formats errors as `{ detail: "code" }`. Normalize to `{ error }`.
  const text = await upstream.text();
  let code = `http_${upstream.status}`;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const raw = typeof parsed.detail === "string" ? parsed.detail : parsed.error;
    if (typeof raw === "string" && raw.length > 0) code = raw;
  } catch {
    // Ignore non-JSON bodies; fall through with http_<status>.
  }
  const status = KNOWN_CODES.has(code) ? 422 : upstream.status;
  return NextResponse.json({ error: code }, { status });
}

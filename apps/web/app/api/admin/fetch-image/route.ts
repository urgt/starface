import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "commons.wikimedia.org"]);
const MAX_BYTES = 12 * 1024 * 1024;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "bad_url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "http_disallowed" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json(
      { error: "host_disallowed", detail: parsed.hostname },
      { status: 400 },
    );
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "User-Agent": "starface-admin/1.0 (dataset enrichment)" },
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "upstream", status: upstream.status },
      { status: 502 },
    );
  }
  const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!ct.startsWith("image/")) {
    return NextResponse.json(
      { error: "not_an_image", contentType: ct },
      { status: 415 },
    );
  }
  const lenHeader = upstream.headers.get("content-length");
  const len = lenHeader ? Number(lenHeader) : 0;
  if (len > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", bytes: len }, { status: 413 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

import { NextResponse } from "next/server";

import { getStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const obj = await getStoredFile(path.join("/"));
  if (!obj) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/octet-stream");
  headers.set("cache-control", "public, max-age=86400");
  headers.set("etag", obj.httpEtag);

  const buffer = await obj.arrayBuffer();
  return new Response(buffer, { headers });
}

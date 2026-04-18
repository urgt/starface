import { NextResponse } from "next/server";

import { getStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const obj = await getStoredFile(path.join("/"));
  if (!obj) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const meta = obj.httpMetadata ?? {};
  const headers = new Headers();
  headers.set("content-type", meta.contentType ?? "application/octet-stream");
  if (meta.contentEncoding) headers.set("content-encoding", meta.contentEncoding);
  if (meta.contentLanguage) headers.set("content-language", meta.contentLanguage);
  if (meta.contentDisposition) headers.set("content-disposition", meta.contentDisposition);
  if (meta.cacheControl) headers.set("cache-control", meta.cacheControl);
  else headers.set("cache-control", "public, max-age=86400");
  headers.set("etag", obj.httpEtag);

  const buffer = await obj.arrayBuffer();
  return new Response(buffer, { headers });
}

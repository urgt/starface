import { NextResponse } from "next/server";

import { readStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = path.join("/");
  try {
    const buffer = await readStoredFile(joined);
    const ext = joined.split(".").pop()?.toLowerCase() ?? "";
    const contentType = EXT_TO_MIME[ext] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}

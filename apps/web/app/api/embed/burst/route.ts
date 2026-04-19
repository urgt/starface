import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

import { proxyEmbed } from "../proxy";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { env } = getCloudflareContext();
  try {
    return await proxyEmbed(req, env, "/embed/burst");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("embed_burst_proxy_error", detail);
    return NextResponse.json({ error: "internal", detail }, { status: 500 });
  }
}

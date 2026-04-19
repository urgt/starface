import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { deleteStoredFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SHARED_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

async function pingModal(env: CloudflareEnv): Promise<{ ok: boolean; detail?: string }> {
  const url = env.MODAL_EMBED_URL;
  if (!url) return { ok: false, detail: "not_configured" };
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/healthz`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok ? { ok: true } : { ok: false, detail: `http_${res.status}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

async function runCleanup(env: CloudflareEnv) {
  // Fire-and-forget health ping. Keeps Modal's HF volume warm and surfaces
  // outages in cron logs long before a user sees them.
  const modal = await pingModal(env);
  if (!modal.ok) console.warn("modal_healthz_failed", modal.detail);

  const now = new Date();
  const expired = await db
    .select({ id: schema.matchResults.id, userPhotoPath: schema.matchResults.userPhotoPath })
    .from(schema.matchResults)
    .where(lt(schema.matchResults.expiresAt, now));

  for (const row of expired) {
    try {
      await deleteStoredFile(row.userPhotoPath);
    } catch {
      /* already gone */
    }
  }

  if (expired.length) {
    await db.delete(schema.matchResults).where(lt(schema.matchResults.expiresAt, now));
  }

  return {
    deletedFiles: expired.length,
    deletedRows: expired.length,
    modal: modal.ok ? "ok" : modal.detail,
  };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { env } = getCloudflareContext();
  return NextResponse.json(await runCleanup(env));
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { env } = getCloudflareContext();
  return NextResponse.json(await runCleanup(env));
}

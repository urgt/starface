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

async function runCleanup() {
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
  };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runCleanup());
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runCleanup());
}

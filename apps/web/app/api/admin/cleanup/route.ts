import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { lt } from "drizzle-orm";

import { appConfig } from "@/lib/config";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const now = new Date();
  const expired = await db
    .select({ id: schema.matchResults.id, userPhotoPath: schema.matchResults.userPhotoPath })
    .from(schema.matchResults)
    .where(lt(schema.matchResults.expiresAt, now));

  let deleted = 0;
  for (const row of expired) {
    try {
      await fs.unlink(path.join(appConfig.dataDir, row.userPhotoPath));
    } catch {
      /* file already gone — ignore */
    }
    deleted++;
  }

  if (expired.length) {
    await db.delete(schema.matchResults).where(lt(schema.matchResults.expiresAt, now));
  }

  return NextResponse.json({ deletedFiles: deleted, deletedRows: expired.length });
}

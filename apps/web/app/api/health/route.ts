import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = { web: "ok" };

  try {
    await db.run(sql`SELECT 1`);
    checks.db = "ok";
  } catch (error) {
    checks.db = `fail: ${(error as Error).message}`;
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: allOk ? "ok" : "degraded", checks });
}

import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = { web: "ok" };

  try {
    await db.execute("SELECT 1");
    checks.db = "ok";
  } catch (error) {
    checks.db = `fail: ${(error as Error).message}`;
  }

  try {
    const mlUrl = process.env.ML_SERVICE_URL ?? "http://localhost:8000";
    const res = await fetch(`${mlUrl}/ml/health`, { cache: "no-store" });
    checks.ml = res.ok ? "ok" : `http_${res.status}`;
  } catch (error) {
    checks.ml = `fail: ${(error as Error).message}`;
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: allOk ? "ok" : "degraded", checks });
}

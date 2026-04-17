import { NextResponse } from "next/server";

import { pingLlm } from "@/lib/description-generator";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST() {
  const result = await pingLlm();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

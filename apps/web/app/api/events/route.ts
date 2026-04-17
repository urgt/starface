import { NextResponse } from "next/server";
import { z } from "zod";

import { recordEvent, type EventType } from "@/lib/analytics";

export const dynamic = "force-dynamic";

const EVENT_TYPES = [
  "kiosk_opened",
  "gesture_detected",
  "match_completed",
  "match_failed",
  "qr_scanned",
  "share_clicked",
  "timeout_reset",
] as const;

const bodySchema = z.object({
  brandId: z.string().min(1).max(64).nullable().optional(),
  resultId: z.string().uuid().nullable().optional(),
  eventType: z.enum(EVENT_TYPES),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: Request) {
  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  await recordEvent({
    brandId: payload.brandId ?? null,
    resultId: payload.resultId ?? null,
    eventType: payload.eventType as EventType,
    metadata: payload.metadata,
  });
  return NextResponse.json({ ok: true });
}

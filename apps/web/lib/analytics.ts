import { db, schema } from "./db";

export type EventType =
  | "kiosk_opened"
  | "gesture_detected"
  | "match_completed"
  | "match_failed"
  | "qr_scanned"
  | "share_clicked"
  | "timeout_reset";

export async function recordEvent(params: {
  brandId?: string | null;
  resultId?: string | null;
  eventType: EventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(schema.events).values({
    brandId: params.brandId ?? null,
    resultId: params.resultId ?? null,
    eventType: params.eventType,
    metadata: params.metadata ?? null,
  });
}

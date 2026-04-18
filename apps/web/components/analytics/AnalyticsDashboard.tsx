import { and, count, desc, eq, gte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

type Funnel = {
  kiosk_opened: number;
  gesture_detected: number;
  match_completed: number;
  qr_scanned: number;
  share_clicked: number;
};

type TopMatch = {
  name: string;
  nameRu: string | null;
  category: string | null;
  matchCount: number;
};

type DailyRow = { day: string; c: number };

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 3600_000);
}

async function loadFunnel(brandId: string | null): Promise<Funnel> {
  const thirtyDaysAgo = since(30);
  const whereClause = brandId
    ? and(eq(schema.events.brandId, brandId), gte(schema.events.createdAt, thirtyDaysAgo))
    : gte(schema.events.createdAt, thirtyDaysAgo);
  const rows = await db
    .select({ eventType: schema.events.eventType, c: count() })
    .from(schema.events)
    .where(whereClause)
    .groupBy(schema.events.eventType);

  const funnel: Funnel = {
    kiosk_opened: 0,
    gesture_detected: 0,
    match_completed: 0,
    qr_scanned: 0,
    share_clicked: 0,
  };
  for (const r of rows) {
    if (r.eventType in funnel) funnel[r.eventType as keyof Funnel] = r.c;
  }
  return funnel;
}

async function loadTop(brandId: string | null): Promise<TopMatch[]> {
  const thirtyDaysAgo = since(30);
  const whereClause = brandId
    ? and(
        eq(schema.matchResults.brandId, brandId),
        gte(schema.matchResults.createdAt, thirtyDaysAgo),
      )
    : gte(schema.matchResults.createdAt, thirtyDaysAgo);
  return db
    .select({
      name: schema.celebrities.name,
      nameRu: schema.celebrities.nameRu,
      category: schema.celebrities.category,
      matchCount: count(),
    })
    .from(schema.matchResults)
    .innerJoin(schema.celebrities, eq(schema.celebrities.id, schema.matchResults.celebrityId))
    .where(whereClause)
    .groupBy(schema.celebrities.name, schema.celebrities.nameRu, schema.celebrities.category)
    .orderBy(desc(count()))
    .limit(20);
}

async function loadDaily(brandId: string | null): Promise<DailyRow[]> {
  const thirtyDaysAgo = since(30);
  const dayExpr = sql<string>`strftime('%Y-%m-%d', ${schema.events.createdAt} / 1000, 'unixepoch')`;
  const whereClause = brandId
    ? and(
        eq(schema.events.brandId, brandId),
        eq(schema.events.eventType, "match_completed"),
        gte(schema.events.createdAt, thirtyDaysAgo),
      )
    : and(
        eq(schema.events.eventType, "match_completed"),
        gte(schema.events.createdAt, thirtyDaysAgo),
      );
  return db
    .select({ day: dayExpr, c: count() })
    .from(schema.events)
    .where(whereClause)
    .groupBy(dayExpr)
    .orderBy(dayExpr);
}

export async function AnalyticsDashboard({ brandId }: { brandId: string | null }) {
  const [funnel, top, daily] = await Promise.all([
    loadFunnel(brandId),
    loadTop(brandId),
    loadDaily(brandId),
  ]);

  const gestureRate = pct(funnel.gesture_detected, funnel.kiosk_opened);
  const matchRate = pct(funnel.match_completed, funnel.gesture_detected);
  const qrRate = pct(funnel.qr_scanned, funnel.match_completed);
  const shareRate = pct(funnel.share_clicked, funnel.qr_scanned);

  const peakDaily = Math.max(1, ...daily.map((d) => d.c));

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Conversion funnel (30d)</h2>
        <div className="grid grid-cols-5 gap-3">
          <Step label="Opened" value={funnel.kiosk_opened} />
          <Step label="✌️" value={funnel.gesture_detected} rate={gestureRate} />
          <Step label="Matched" value={funnel.match_completed} rate={matchRate} />
          <Step label="QR scans" value={funnel.qr_scanned} rate={qrRate} />
          <Step label="Shared" value={funnel.share_clicked} rate={shareRate} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Matches per day</h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          {daily.length === 0 ? (
            <p className="py-8 text-center text-neutral-400">No data</p>
          ) : (
            <div className="flex h-40 items-end gap-2">
              {daily.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-neutral-900"
                    style={{ height: `${(d.c / peakDaily) * 100}%`, minHeight: 2 }}
                    title={`${d.day}: ${d.c}`}
                  />
                  <span className="text-[10px] text-neutral-500">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Top matches</h2>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Celebrity</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium text-right">Matches</th>
              </tr>
            </thead>
            <tbody>
              {top.map((row) => (
                <tr key={row.name} className="border-t border-neutral-100">
                  <td className="px-4 py-2">
                    {row.name}{" "}
                    {row.nameRu && <span className="text-neutral-400">· {row.nameRu}</span>}
                  </td>
                  <td className="px-4 py-2 uppercase text-xs text-neutral-500">
                    {row.category ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.matchCount}</td>
                </tr>
              ))}
              {top.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-neutral-400" colSpan={3}>
                    No matches yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Step({ label, value, rate }: { label: string; value: number; rate?: string | null }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {rate && <p className="text-xs text-neutral-500">{rate}</p>}
    </div>
  );
}

function pct(a: number, b: number): string | null {
  if (!b) return null;
  return `${Math.round((a / b) * 100)}% from prev`;
}

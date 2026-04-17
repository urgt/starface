import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

type Funnel = {
  kiosk_opened: number;
  gesture_detected: number;
  match_completed: number;
  qr_scanned: number;
  share_clicked: number;
};

type TopMatch = {
  name: string;
  name_ru: string | null;
  category: string | null;
  match_count: number;
};

type DailyRow = { day: string; c: number };

async function loadFunnel(brandId: string | null): Promise<Funnel> {
  const rows = await db.execute<{ event_type: string; c: number }>(sql`
    SELECT event_type, count(*)::int AS c
    FROM events
    WHERE (${brandId}::text IS NULL OR brand_id = ${brandId})
      AND created_at > now() - interval '30 days'
    GROUP BY event_type
  `);
  const funnel: Funnel = {
    kiosk_opened: 0,
    gesture_detected: 0,
    match_completed: 0,
    qr_scanned: 0,
    share_clicked: 0,
  };
  for (const r of rows) {
    if (r.event_type in funnel) funnel[r.event_type as keyof Funnel] = r.c;
  }
  return funnel;
}

async function loadTop(brandId: string | null): Promise<TopMatch[]> {
  return db.execute<TopMatch>(sql`
    SELECT c.name, c.name_ru, c.category, count(*)::int AS match_count
    FROM match_results m
    JOIN celebrities c ON c.id = m.celebrity_id
    WHERE (${brandId}::text IS NULL OR m.brand_id = ${brandId})
      AND m.created_at > now() - interval '30 days'
    GROUP BY c.name, c.name_ru, c.category
    ORDER BY match_count DESC
    LIMIT 20
  `);
}

async function loadDaily(brandId: string | null): Promise<DailyRow[]> {
  return db.execute<DailyRow>(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           count(*)::int AS c
    FROM events
    WHERE (${brandId}::text IS NULL OR brand_id = ${brandId})
      AND event_type = 'match_completed'
      AND created_at > now() - interval '30 days'
    GROUP BY day
    ORDER BY day
  `);
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
                    {row.name} {row.name_ru && <span className="text-neutral-400">· {row.name_ru}</span>}
                  </td>
                  <td className="px-4 py-2 uppercase text-xs text-neutral-500">{row.category ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.match_count}</td>
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

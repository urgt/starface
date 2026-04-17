import { count, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const [[brandCount], [celebCount], [eventCount]] = await Promise.all([
    db.select({ c: count() }).from(schema.brands),
    db.select({ c: count() }).from(schema.celebrities),
    db.select({ c: count() }).from(schema.events),
  ]);

  const recent = await db.execute<{ event_type: string; c: number }>(sql`
    SELECT event_type, count(*)::int AS c
    FROM events
    WHERE created_at > now() - interval '7 days'
    GROUP BY event_type
    ORDER BY c DESC
  `);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4">
        <Card label="Brands" value={brandCount.c} />
        <Card label="Celebrities" value={celebCount.c} />
        <Card label="Events (all time)" value={eventCount.c} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Events, last 7 days</h2>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.event_type} className="border-t border-neutral-100">
                  <td className="px-4 py-2">{row.event_type}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{row.c}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-neutral-400" colSpan={2}>
                    No events yet
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

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
      <p className="text-xs uppercase tracking-widest text-neutral-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

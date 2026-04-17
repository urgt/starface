import Link from "next/link";

import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function BrandsListPage() {
  const rows = await db.select().from(schema.brands).orderBy(schema.brands.createdAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Brands</h1>
        <Link
          href="/admin/brands/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
        >
          + New brand
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Theme</th>
              <th className="px-4 py-2 font-medium">Promo</th>
              <th className="px-4 py-2 font-medium">Active</th>
              <th className="px-4 py-2 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-neutral-100">
                <td className="px-4 py-2 font-mono text-xs">{b.id}</td>
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/brands/${b.id}`}
                    className="font-medium text-neutral-900 underline-offset-2 hover:underline"
                  >
                    {b.name}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    <ColorDot color={b.primaryColor ?? "#FF5E3A"} />
                    <ColorDot color={b.bgGradientFrom ?? "#1a0b2e"} />
                    <ColorDot color={b.bgGradientTo ?? "#0a0a0a"} />
                  </div>
                </td>
                <td className="px-4 py-2">{b.promoCode ?? "—"}</td>
                <td className="px-4 py-2">{b.active ? "✓" : "—"}</td>
                <td className="px-4 py-2">
                  <div className="flex gap-2 text-xs text-neutral-500">
                    <Link
                      href={`/kiosk?brand=${b.id}`}
                      target="_blank"
                      className="underline-offset-2 hover:underline"
                    >
                      kiosk
                    </Link>
                    <Link
                      href={`/demo/result?brand=${b.id}`}
                      target="_blank"
                      className="underline-offset-2 hover:underline"
                    >
                      demo
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-neutral-400" colSpan={6}>
                  No brands yet — create one
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      title={color}
      className="inline-block h-4 w-4 rounded-full border border-neutral-200"
      style={{ backgroundColor: color }}
    />
  );
}

import Link from "next/link";

import { EnrichQueuePanel } from "@/components/admin/EnrichQueuePanel";
import { QueuePanel } from "@/components/admin/QueuePanel";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="text-xl font-bold">
            StarFace admin
          </Link>
          <nav className="flex gap-4 text-sm font-medium text-neutral-600">
            <Link href="/admin/brands" className="hover:text-neutral-900">Brands</Link>
            <Link href="/admin/celebrities" className="hover:text-neutral-900">Celebrities</Link>
            <Link href="/admin/analytics" className="hover:text-neutral-900">Analytics</Link>
            <Link href="/admin/settings" className="hover:text-neutral-900">Settings</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <QueuePanel />
      <EnrichQueuePanel />
    </div>
  );
}

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="max-w-xl px-6 py-12 text-center space-y-6">
        <h1 className="text-4xl font-bold">StarFace UZ</h1>
        <p className="text-neutral-400">
          B2B white-label platform for celebrity look-alike kiosks.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/kiosk?brand=demo"
            className="rounded-lg bg-brand px-5 py-2.5 font-semibold text-white"
          >
            Open demo kiosk
          </Link>
          <Link
            href="/admin"
            prefetch={false}
            className="rounded-lg border border-neutral-700 px-5 py-2.5"
          >
            Admin
          </Link>
        </div>
      </div>
    </main>
  );
}

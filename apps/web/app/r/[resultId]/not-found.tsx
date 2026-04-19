import Link from "next/link";

import { dict } from "@/lib/i18n";

export default function NotFound() {
  const uz = dict.uz;
  const ru = dict.ru;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-brand-gradient p-6 font-brand">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/40 p-8 text-center text-white shadow-2xl backdrop-blur">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand-primary)]/20 text-2xl">
          ✌️
        </div>
        <h1 className="text-2xl font-bold">{uz.resultNotFoundTitle}</h1>
        <p className="mt-2 text-sm text-white/70">{uz.resultNotFoundBody}</p>
        <div className="my-5 h-px bg-white/10" />
        <p className="text-lg font-semibold text-white/90">{ru.resultNotFoundTitle}</p>
        <p className="mt-1 text-sm text-white/60">{ru.resultNotFoundBody}</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-[var(--brand-primary)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.02]"
        >
          StarFace
        </Link>
      </div>
    </div>
  );
}

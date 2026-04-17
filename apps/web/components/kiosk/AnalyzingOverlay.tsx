"use client";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export function AnalyzingOverlay({ locale }: { locale: Locale }) {
  const dict = t(locale);
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-8 bg-black/85 backdrop-blur-sm">
      <div className="relative h-28 w-28">
        <div className="absolute inset-0 animate-ping rounded-full bg-[var(--brand-primary)]/40" />
        <div className="absolute inset-4 rounded-full bg-[var(--brand-primary)]" />
      </div>
      <p className="text-3xl font-semibold tracking-wide">{dict.analyzing}</p>
    </div>
  );
}

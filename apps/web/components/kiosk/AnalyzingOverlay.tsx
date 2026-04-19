"use client";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export function AnalyzingOverlay({ locale }: { locale: Locale }) {
  const dict = t(locale);
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-brand-gradient font-brand tv:gap-8">
      <div className="relative h-28 w-28 tv:h-40 tv:w-40">
        <div
          className="absolute inset-0 rounded-full border-2 border-[var(--brand-primary)]/50"
          style={{ animation: "glowPulse 2.4s ease-in-out infinite" }}
        />
        <div className="absolute inset-6 rounded-full bg-[var(--brand-primary)] tv:inset-8" />
        <div
          className="absolute inset-0 overflow-hidden rounded-full"
          style={{ mask: "radial-gradient(circle, black 40%, transparent 70%)" }}
        >
          <div
            className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/70 to-transparent"
            style={{ animation: "mosaicScroll 1.8s linear infinite" }}
          />
        </div>
      </div>
      <div className="text-center">
        <p className="text-xl font-semibold tracking-tight text-white tv:text-3xl">
          {dict.analyzing}
        </p>
        <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-white/50 tv:text-sm">
          {dict.analyzingHint}
        </p>
      </div>
    </div>
  );
}

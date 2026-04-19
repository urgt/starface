"use client";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export function AnalyzingOverlay({ locale }: { locale: Locale }) {
  const dict = t(locale);
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-brand-gradient font-brand"
      style={{ gap: "calc(var(--kiosk-gap) * 1.4)", padding: "var(--kiosk-pad)" }}
    >
      <div
        className="relative"
        style={{
          width: "clamp(7rem, 14vw, 18rem)",
          height: "clamp(7rem, 14vw, 18rem)",
        }}
      >
        <div
          className="absolute inset-0 rounded-full border-2 border-[var(--brand-primary)]/50"
          style={{ animation: "glowPulse 2.4s ease-in-out infinite" }}
        />
        <div
          className="absolute rounded-full bg-[var(--brand-primary)]"
          style={{ inset: "18%" }}
        />
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
      <div className="text-center" style={{ display: "grid", gap: "calc(var(--kiosk-gap) * 0.5)" }}>
        <p
          className="font-semibold tracking-tight text-white"
          style={{ fontSize: "var(--kiosk-text-xl)" }}
        >
          {dict.analyzing}
        </p>
        <p
          className="uppercase tracking-[0.22em] text-white/50"
          style={{ fontSize: "var(--kiosk-badge-text)" }}
        >
          {dict.analyzingHint}
        </p>
      </div>
      <div
        className="kiosk-shimmer"
        style={{
          width: "clamp(180px, 22vw, 360px)",
          height: "3px",
        }}
        aria-hidden
      />
    </div>
  );
}

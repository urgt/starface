"use client";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import {
  brandHeadline,
  brandSubtitle,
  type BrandTheme,
} from "@/lib/brand-theme";
import { CelebrityMosaic } from "./CelebrityMosaic";

type Props = {
  brand: BrandTheme;
  locale: Locale;
};

export function IdleScreen({ brand, locale }: Props) {
  const dict = t(locale);
  const headline =
    brandHeadline(brand, locale) ??
    (locale === "uz" ? brand.idleTextUz : brand.idleTextRu) ??
    dict.headlineDefault;
  const subtitle = brandSubtitle(brand, locale) ?? dict.subtitleDefault;

  return (
    <div className="relative flex h-full w-full flex-col bg-brand-gradient font-brand">
      {/* Celebrity mosaic — background layer */}
      <div className="absolute inset-0 opacity-40">
        <CelebrityMosaic columns={6} maxItems={24} />
      </div>

      {/* Vignette darkening so foreground text stays readable */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_55%,transparent_0%,var(--brand-gradient-to)_85%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-60 bg-gradient-to-t from-black/80 to-transparent" />

      {/* Top bar: logo */}
      <header className="relative z-10 flex items-center justify-between px-10 pt-10">
        <div className="flex items-center gap-4">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className="max-h-16 max-w-[220px] object-contain drop-shadow-[0_4px_30px_rgba(0,0,0,0.4)]"
            />
          ) : (
            <div className="rounded-2xl bg-white/10 px-5 py-2 text-lg font-semibold tracking-tight text-white/90 backdrop-blur">
              {brand.name}
            </div>
          )}
        </div>
        <div className="mr-32 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-white/60 backdrop-blur">
          {dict.celebritiesShown}
        </div>
      </header>

      {/* Center content */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-10 text-center">
        <span
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/10 px-5 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--brand-primary)] backdrop-blur"
          style={{ animation: "floatIn 600ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
          {dict.readyToSee}
        </span>

        <h1
          className="max-w-5xl text-[clamp(3rem,7vw,7rem)] font-black leading-[0.95] tracking-tight text-white"
          style={{ animation: "floatIn 700ms 80ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          {headline}
        </h1>

        <p
          className="mt-6 max-w-3xl text-xl text-white/70 md:text-2xl"
          style={{ animation: "floatIn 700ms 160ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          {subtitle}
        </p>

        <div
          className="mt-12 flex flex-col items-center gap-4"
          style={{ animation: "floatIn 800ms 260ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <div className="relative">
            <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-[var(--brand-primary)]/20 blur-3xl" />
            <div className="text-[9rem] leading-none animate-pulse-slow select-none">✌️</div>
          </div>
          <p className="text-3xl font-bold text-white">
            {t(locale).idleCta}
          </p>
          <p className="text-sm text-white/50">{dict.stepBackHint}</p>
        </div>
      </main>

      {/* Consent */}
      <footer className="relative z-10 px-10 pb-10">
        <p className="mx-auto max-w-3xl text-center text-xs text-white/40">{dict.consent}</p>
      </footer>
    </div>
  );
}

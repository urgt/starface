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
        <CelebrityMosaic columns={4} maxItems={12} />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_55%,transparent_0%,var(--brand-gradient-to)_85%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent tv:h-40" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/80 to-transparent tv:h-60" />

      {/* Top bar: logo */}
      <header className="relative z-10 flex items-center justify-between px-4 pt-4 tv:px-8 tv:pt-8 tv-hd:px-10 tv-hd:pt-10">
        <div className="flex items-center gap-4">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className="max-h-10 max-w-[140px] object-contain tv:max-h-14 tv:max-w-[180px] tv-hd:max-h-16 tv-hd:max-w-[220px]"
            />
          ) : (
            <div className="rounded-2xl bg-white/10 px-3 py-1.5 text-sm font-semibold tracking-tight text-white/90 tv:px-5 tv:py-2 tv:text-lg">
              {brand.name}
            </div>
          )}
        </div>
        <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/60 tv:mr-24 tv:inline-block tv:px-4 tv:py-1.5 tv:text-xs tv-hd:mr-32">
          {dict.celebritiesShown}
        </div>
      </header>

      {/* Center content */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 text-center tv:px-8 tv-hd:px-10">
        <span
          className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-primary)] tv:mb-6 tv:px-5 tv:py-2 tv:text-sm"
          style={{ animation: "floatIn 600ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
          {dict.readyToSee}
        </span>

        <h1
          className="max-w-5xl font-black leading-[0.95] tracking-tight text-white"
          style={{
            fontSize: "clamp(1.75rem, 6vw, 6rem)",
            animation: "floatIn 700ms 80ms cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          {headline}
        </h1>

        <p
          className="mt-3 max-w-3xl text-sm text-white/70 tv:mt-6 tv:text-lg tv-hd:text-2xl"
          style={{ animation: "floatIn 700ms 160ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          {subtitle}
        </p>

        <div
          className="mt-6 flex flex-col items-center gap-2 tv:mt-12 tv:gap-4"
          style={{ animation: "floatIn 800ms 260ms cubic-bezier(0.16,1,0.3,1) both" }}
        >
          <div
            className="select-none leading-none"
            style={{ fontSize: "clamp(3rem, 12vh, 8rem)" }}
          >
            ✌️
          </div>
          <p className="text-lg font-bold text-white tv:text-2xl tv-hd:text-3xl">
            {t(locale).idleCta}
          </p>
          <p className="text-xs text-white/50 tv:text-sm">{dict.stepBackHint}</p>
        </div>
      </main>

      {/* Consent */}
      <footer className="relative z-10 px-4 pb-4 tv:px-8 tv:pb-8 tv-hd:px-10 tv-hd:pb-10">
        <p className="mx-auto max-w-3xl text-center text-[10px] text-white/40 tv:text-xs">
          {dict.consent}
        </p>
      </footer>
    </div>
  );
}

"use client";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import {
  brandHeadline,
  brandSubtitle,
  type BrandTheme,
} from "@/lib/brand-theme";
import { CelebrityMosaic } from "./CelebrityMosaic";
import { LocaleToggle } from "./LocaleToggle";

type Props = {
  brand: BrandTheme;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
};

export function IdleScreen({ brand, locale, onLocaleChange }: Props) {
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
        <CelebrityMosaic maxItems={16} />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_55%,transparent_0%,var(--brand-gradient-to)_85%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[18vh] bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[24vh] bg-gradient-to-t from-black/80 to-transparent" />

      {/* Top bar: logo + badge + locale */}
      <header
        className="relative z-10 flex flex-wrap items-center justify-between"
        style={{
          gap: "var(--kiosk-gap)",
          paddingInline: "var(--kiosk-pad)",
          paddingTop: "var(--kiosk-pad)",
        }}
      >
        <div className="flex items-center" style={{ gap: "var(--kiosk-gap)" }}>
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className="object-contain"
              style={{
                maxHeight: "clamp(2.25rem, 3.5vw, 4rem)",
                maxWidth: "clamp(7rem, 14vw, 16rem)",
              }}
            />
          ) : (
            <div
              className="rounded-2xl bg-white/10 font-semibold tracking-tight text-white/90"
              style={{
                paddingInline: "clamp(0.75rem, 1vw, 1.25rem)",
                paddingBlock: "clamp(0.35rem, 0.5vw, 0.6rem)",
                fontSize: "var(--kiosk-text-sm)",
              }}
            >
              {brand.name}
            </div>
          )}
        </div>
        <div className="flex items-center" style={{ gap: "var(--kiosk-gap)" }}>
          <div
            className="hidden items-center rounded-full border border-white/10 bg-white/5 font-semibold uppercase tracking-[0.2em] text-white/60 md:inline-flex"
            style={{
              paddingInline: "clamp(0.75rem, 1.1vw, 1.25rem)",
              paddingBlock: "clamp(0.25rem, 0.45vw, 0.55rem)",
              fontSize: "var(--kiosk-badge-text)",
            }}
          >
            {dict.celebritiesShown}
          </div>
          <LocaleToggle locale={locale} onChange={onLocaleChange} />
        </div>
      </header>

      {/* Center content */}
      <main
        className="relative z-10 flex flex-1 flex-col items-center justify-center text-center"
        style={{ paddingInline: "var(--kiosk-pad)" }}
      >
        <span
          className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/30 bg-[var(--brand-primary)]/10 font-semibold uppercase tracking-[0.22em] text-[var(--brand-primary)]"
          style={{
            paddingInline: "clamp(0.75rem, 1.2vw, 1.5rem)",
            paddingBlock: "clamp(0.3rem, 0.5vw, 0.65rem)",
            fontSize: "var(--kiosk-badge-text)",
            animation: "floatIn 600ms cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
          {dict.readyToSee}
        </span>

        <h1
          className="max-w-[min(92%,70rem)] font-black leading-[0.95] tracking-tight text-white"
          style={{
            fontSize: "var(--kiosk-headline)",
            animation: "floatIn 700ms 80ms cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          {headline}
        </h1>

        <p
          className="max-w-[min(92%,52rem)] text-white/70"
          style={{
            marginTop: "var(--kiosk-gap)",
            fontSize: "var(--kiosk-text-md)",
            animation: "floatIn 700ms 160ms cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          {subtitle}
        </p>

        <div
          className="flex flex-col items-center"
          style={{
            marginTop: "calc(var(--kiosk-gap) * 1.8)",
            gap: "calc(var(--kiosk-gap) * 0.6)",
            animation: "floatIn 800ms 260ms cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          <div
            className="select-none leading-none"
            style={{ fontSize: "var(--kiosk-emoji)" }}
          >
            ✌️
          </div>
          <p
            className="font-bold text-white"
            style={{ fontSize: "var(--kiosk-text-xl)" }}
          >
            {dict.idleCta}
          </p>
          <p className="text-white/50" style={{ fontSize: "var(--kiosk-text-xs)" }}>
            {dict.stepBackHint}
          </p>
        </div>
      </main>

      {/* Consent */}
      <footer
        className="relative z-10"
        style={{
          paddingInline: "var(--kiosk-pad)",
          paddingBottom: "var(--kiosk-pad)",
        }}
      >
        <p
          className="mx-auto max-w-[min(92%,56rem)] text-center text-white/40"
          style={{ fontSize: "var(--kiosk-text-xs)" }}
        >
          {dict.consent}
        </p>
      </footer>
    </div>
  );
}

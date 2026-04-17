import { type CSSProperties } from "react";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import {
  brandCssVars,
  brandCtaLabel,
  brandPromoText,
  type BrandTheme,
} from "@/lib/brand-theme";
import { ResultActions } from "./ResultActions";
import { ResultCta } from "./ResultCta";

export type ResultCardData = {
  resultId: string | null;
  similarity: number;
  userPhotoUrl: string;
  celebrity: {
    name: string;
    nameRu: string | null;
    descriptionUz: string | null;
    descriptionRu: string | null;
    descriptionEn: string | null;
    photoUrl: string | null;
  };
  shareUrl: string | null;
  demo?: boolean;
};

type Props = {
  data: ResultCardData;
  brand: BrandTheme;
  locale: Locale;
};

export function ResultCard({ data, brand, locale }: Props) {
  const dict = t(locale);
  const cssVars: CSSProperties = brandCssVars(brand);

  const celebName =
    locale === "ru" ? data.celebrity.nameRu ?? data.celebrity.name : data.celebrity.name;
  const { descriptionUz, descriptionRu, descriptionEn } = data.celebrity;
  const description =
    locale === "ru"
      ? descriptionRu || descriptionUz || descriptionEn
      : descriptionUz || descriptionRu || descriptionEn;

  const promoText = brandPromoText(brand, locale);
  const ctaLabel = brandCtaLabel(brand, locale);
  const ctaUrl = brand.ctaUrl;

  return (
    <div className="relative min-h-screen bg-brand-gradient font-brand text-white" style={cssVars}>
      {/* ambient glows */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-[var(--brand-primary)]/20 blur-3xl" />

      <div className="relative mx-auto max-w-md px-5 py-8 md:max-w-lg">
        {/* top brand row */}
        <header className="flex items-center justify-between">
          {brand.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={brand.logoUrl}
              alt={dict.brandLogoAlt}
              className="h-10 max-w-[180px] object-contain"
            />
          ) : brand.id === "__default" ? (
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
              StarFace
            </span>
          ) : (
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">
              {brand.name}
            </span>
          )}
          {data.demo && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)]" />
              {dict.demoBadge}
            </span>
          )}
        </header>

        {/* Photo showcase */}
        <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
          <div className="relative aspect-square">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.userPhotoUrl}
              alt="you"
              className="h-full w-full object-cover scale-x-[-1]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
            <div className="absolute bottom-3 left-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              {locale === "ru" ? "Вы" : "Siz"}
            </div>
          </div>
          <div className="relative aspect-square border-l border-white/10">
            {data.celebrity.photoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={data.celebrity.photoUrl}
                alt={celebName}
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
            <div className="absolute bottom-3 right-3 max-w-[85%] text-right text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              {celebName}
            </div>
          </div>
        </div>

        {/* Similarity */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--brand-primary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-primary)]" />
            {dict.match}
          </div>
          <div
            className="mt-2 font-brand font-black leading-none text-[var(--brand-primary)]"
            style={{
              fontSize: "clamp(4rem, 22vw, 7rem)",
              textShadow: "0 0 40px var(--brand-primary)",
            }}
          >
            {data.similarity}
            <span className="text-3xl md:text-5xl">%</span>
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/50">{dict.similarity}</p>
          <p className="mt-4 text-2xl font-bold text-white">{celebName}</p>
          {description && (
            <p className="mt-3 text-base leading-snug text-white/75">{description}</p>
          )}
        </div>

        {/* Promo */}
        {brand.promoCode && (
          <div className="mt-6 rounded-3xl border border-dashed border-[var(--brand-primary)]/60 bg-[var(--brand-primary)]/10 p-6 text-center backdrop-blur">
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">{dict.promo}</p>
            {promoText && <p className="mt-1 text-sm text-white/90">{promoText}</p>}
            <p className="mt-3 text-3xl font-black tracking-[0.2em] text-[var(--brand-primary)]">
              {brand.promoCode}
            </p>
          </div>
        )}

        {/* Primary brand CTA (above share) */}
        {ctaLabel && ctaUrl && (
          <ResultCta
            label={ctaLabel}
            url={ctaUrl}
            resultId={data.resultId}
            brandId={brand.id === "__default" ? null : brand.id}
          />
        )}

        {/* Share actions */}
        {data.shareUrl && data.resultId && !data.demo && (
          <div className="mt-5">
            <ResultActions
              resultId={data.resultId}
              brandId={brand.id === "__default" ? null : brand.id}
              shareUrl={data.shareUrl}
              shareText={`${celebName} — ${data.similarity}% ${dict.similarity} · StarFace UZ`}
              dict={{
                share: dict.share,
                telegram: dict.shareTelegram,
                copy: dict.copyLink,
                copied: dict.linkCopied,
              }}
            />
          </div>
        )}

        {data.demo && (
          <p className="mt-8 text-center text-xs text-white/40">{dict.demoHint}</p>
        )}
      </div>
    </div>
  );
}

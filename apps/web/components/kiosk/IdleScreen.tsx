"use client";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

type Props = {
  brandName: string;
  logoUrl: string | null;
  idleTextUz: string | null;
  idleTextRu: string | null;
  locale: Locale;
};

export function IdleScreen({ brandName, logoUrl, idleTextUz, idleTextRu, locale }: Props) {
  const dict = t(locale);
  const customTitle = locale === "uz" ? idleTextUz : idleTextRu;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-10 bg-gradient-to-b from-neutral-900 via-neutral-950 to-black px-12 text-center">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={brandName} className="max-h-32 max-w-[320px] object-contain" />
      ) : (
        <div className="text-2xl font-semibold text-neutral-300">{brandName}</div>
      )}

      <h1 className="max-w-5xl text-6xl font-bold leading-tight tracking-tight text-white">
        {customTitle ?? dict.idleTitle}
      </h1>

      <div className="flex flex-col items-center gap-4">
        <div className="text-9xl animate-pulse-slow">✌️</div>
        <p className="text-3xl font-semibold text-[var(--brand-primary)]">{dict.idleCta}</p>
      </div>

      <p className="absolute bottom-8 max-w-3xl px-6 text-sm text-neutral-500">
        {dict.consent}
      </p>
    </div>
  );
}

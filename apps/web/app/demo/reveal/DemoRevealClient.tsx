"use client";

import { useState } from "react";

import { brandCssVars, type BrandTheme } from "@/lib/brand-theme";
import type { Locale } from "@/lib/i18n";
import { RevealScreen, type RevealPayload } from "@/components/kiosk/RevealScreen";

type Props = {
  payload: RevealPayload;
  locale: Locale;
  brand: BrandTheme;
  appUrl: string;
};

export function DemoRevealClient({ payload, locale: initialLocale, brand, appUrl }: Props) {
  const [replayKey, setReplayKey] = useState(0);
  const [locale, setLocale] = useState<Locale>(initialLocale);

  return (
    <div
      className="relative h-[100dvh] w-[100dvw] overflow-hidden bg-black font-brand"
      style={brandCssVars(brand)}
    >
      <RevealScreen
        key={replayKey}
        payload={payload}
        locale={locale}
        onLocaleChange={setLocale}
        brand={brand}
        appUrl={appUrl}
        idleSeconds={9999}
        onReset={() => {}}
      />
      <button
        type="button"
        onClick={() => setReplayKey((k) => k + 1)}
        className="fixed bottom-4 left-4 z-50 rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-neutral-900 shadow-lg hover:bg-white"
      >
        ↻ Replay reveal
      </button>
    </div>
  );
}

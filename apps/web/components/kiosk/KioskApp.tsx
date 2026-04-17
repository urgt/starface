"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n";
import { AnalyzingOverlay } from "./AnalyzingOverlay";
import { GestureCamera, type GestureCameraHandle } from "./GestureCamera";
import { IdleScreen } from "./IdleScreen";
import { LocaleToggle } from "./LocaleToggle";
import { RevealScreen, type RevealPayload } from "./RevealScreen";

type BrandConfig = {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  idleTextUz: string | null;
  idleTextRu: string | null;
};

type Props = {
  brand: BrandConfig;
  appUrl: string;
};

type Phase = "idle" | "analyzing" | "reveal" | "error";

const LOCALE_KEY = "starface.locale";

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "uz";
  const raw = window.localStorage.getItem(LOCALE_KEY);
  return raw === "ru" ? "ru" : "uz";
}

export function KioskApp({ brand, appUrl }: Props) {
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cameraRef = useRef<GestureCameraHandle>(null);
  const shutterRef = useRef<HTMLAudioElement | null>(null);

  const cssVars = useMemo(
    () =>
      ({
        "--brand-primary": brand.primaryColor,
        "--brand-accent": brand.accentColor,
      }) as React.CSSProperties,
    [brand.primaryColor, brand.accentColor],
  );

  useEffect(() => {
    window.localStorage.setItem(LOCALE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    fetch("/shutter.mp3", { method: "HEAD" })
      .then((r) => {
        if (cancelled || !r.ok) return;
        const audio = new Audio("/shutter.mp3");
        audio.preload = "auto";
        shutterRef.current = audio;
      })
      .catch(() => {});
    fireEvent({ brandId: brand.id, eventType: "kiosk_opened" });
    return () => {
      cancelled = true;
    };
  }, [brand.id]);

  const resetToIdle = useCallback(() => {
    setReveal(null);
    setErrorMessage(null);
    setPhase("idle");
    fireEvent({ brandId: brand.id, eventType: "timeout_reset" });
  }, [brand.id]);

  const handleGesture = useCallback(async () => {
    if (phase !== "idle") return;

    shutterRef.current?.play().catch(() => {});
    fireEvent({ brandId: brand.id, eventType: "gesture_detected" });

    const image = cameraRef.current?.capture();
    if (!image) {
      setErrorMessage("Не удалось сделать снимок");
      setPhase("error");
      setTimeout(resetToIdle, 3000);
      return;
    }

    setPhase("analyzing");
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: brand.id, imageBase64: image }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `http_${res.status}`);
      }
      const data = (await res.json()) as RevealPayload;
      setReveal(data);
      setPhase("reveal");
    } catch (err) {
      console.warn("match failed", err);
      const msg = (err as Error).name === "TimeoutError" ? "timeout" : (err as Error).message;
      setErrorMessage(humanizeError(msg));
      setPhase("error");
      setTimeout(resetToIdle, 3000);
    }
  }, [phase, brand.id, resetToIdle]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black" style={cssVars}>
      <div className="absolute right-6 top-6 z-30">
        <LocaleToggle locale={locale} onChange={setLocale} />
      </div>

      <div className={phase === "idle" ? "h-full w-full" : "absolute inset-0 opacity-0 pointer-events-none"}>
        <GestureCamera
          ref={cameraRef}
          active={phase === "idle"}
          onGestureDetected={handleGesture}
        />
        {phase === "idle" && (
          <div className="pointer-events-none absolute inset-0">
            <IdleScreen
              brandName={brand.name}
              logoUrl={brand.logoUrl}
              idleTextUz={brand.idleTextUz}
              idleTextRu={brand.idleTextRu}
              locale={locale}
            />
          </div>
        )}
      </div>

      {phase === "analyzing" && <AnalyzingOverlay locale={locale} />}

      {phase === "reveal" && reveal && (
        <RevealScreen
          payload={reveal}
          locale={locale}
          brandId={brand.id}
          appUrl={appUrl}
          onReset={resetToIdle}
        />
      )}

      {phase === "error" && errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85">
          <div className="max-w-xl rounded-2xl bg-neutral-900 p-8 text-center">
            <p className="text-2xl font-semibold text-red-300">{errorMessage}</p>
            <p className="mt-2 text-neutral-500">Возврат к заставке...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function fireEvent(body: {
  brandId?: string;
  resultId?: string;
  eventType: string;
  metadata?: Record<string, unknown>;
}) {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

function humanizeError(code: string): string {
  switch (code) {
    case "no_face":
      return "Лицо не обнаружено. Встаньте ближе к камере";
    case "multiple_faces":
      return "В кадре несколько лиц. Покажите ✌️ один";
    case "low_quality":
      return "Снимок получился нечётким. Попробуйте ещё раз";
    case "brand_not_found":
      return "Этот бренд не найден";
    case "no_celebrities":
      return "База знаменитостей ещё не загружена";
    case "timeout":
      return "Сервис не отвечает. Попробуйте ещё раз";
    default:
      return "Что-то пошло не так. Попробуйте ещё раз";
  }
}

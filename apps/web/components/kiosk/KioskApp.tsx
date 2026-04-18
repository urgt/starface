"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Locale } from "@/lib/i18n";
import { brandCssVars, type BrandTheme } from "@/lib/brand-theme";
import { bitmapFromDataUrl, embedBurst, FaceEmbedError } from "@/lib/face-embed";
import { AnalyzingOverlay } from "./AnalyzingOverlay";
import { GestureCamera, type GestureCameraHandle } from "./GestureCamera";
import { IdleScreen } from "./IdleScreen";
import { LocaleToggle } from "./LocaleToggle";
import { RevealScreen, type RevealPayload } from "./RevealScreen";

type Props = {
  brand: BrandTheme;
  appUrl: string;
};

type Phase = "idle" | "analyzing" | "reveal" | "error";

const LOCALE_KEY = "starface.locale";

export function KioskApp({ brand, appUrl }: Props) {
  const [locale, setLocale] = useState<Locale>("uz");
  const [phase, setPhase] = useState<Phase>("idle");
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cameraRef = useRef<GestureCameraHandle>(null);
  const shutterRef = useRef<HTMLAudioElement | null>(null);

  const cssVars = useMemo(() => brandCssVars(brand), [brand]);

  // Hydrate locale from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    const raw = window.localStorage.getItem(LOCALE_KEY);
    if (raw === "ru" || raw === "uz") setLocale(raw);
  }, []);

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
        audio.volume = 0.7;
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

    // Shutter fires exactly once here — at the moment the burst is captured.
    // RevealScreen's flash is silent so we don't double up.
    shutterRef.current?.play().catch(() => {});
    fireEvent({ brandId: brand.id, eventType: "gesture_detected" });

    const frames = (await cameraRef.current?.captureBurst(3, 80)) ?? [];
    if (frames.length === 0) {
      setErrorMessage("Не удалось сделать снимок");
      setPhase("error");
      setTimeout(resetToIdle, 3000);
      return;
    }

    setPhase("analyzing");
    try {
      const bitmaps = await Promise.all(frames.map((f) => bitmapFromDataUrl(f)));
      const embed = await embedBurst(bitmaps);
      bitmaps.forEach((b) => b.close());

      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: brand.id,
          embedding: embed.embedding,
          userPhotoBase64: frames[0],
          detScore: embed.detScore,
          faceQuality: embed.faceQuality,
        }),
        signal: AbortSignal.timeout(25_000),
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
      const code =
        err instanceof FaceEmbedError
          ? err.code
          : (err as Error).name === "TimeoutError"
            ? "timeout"
            : (err as Error).message;
      setErrorMessage(humanizeError(code));
      setPhase("error");
      setTimeout(resetToIdle, 3000);
    }
  }, [phase, brand.id, resetToIdle]);

  const cameraVariant =
    phase === "idle" ? "corner" : phase === "analyzing" ? "hidden" : "hidden";

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-brand-gradient-soft font-brand"
      style={cssVars}
    >
      <div className="absolute right-6 top-6 z-30">
        <LocaleToggle locale={locale} onChange={setLocale} />
      </div>

      {/* Idle screen: mosaic + headline, corner camera on top */}
      {phase === "idle" && (
        <div className="absolute inset-0">
          <IdleScreen brand={brand} locale={locale} />
        </div>
      )}

      {/* Camera is always mounted so stream + gesture detection persist */}
      <GestureCamera
        ref={cameraRef}
        active={phase === "idle"}
        onGestureDetected={handleGesture}
        variant={cameraVariant}
      />

      {phase === "analyzing" && <AnalyzingOverlay locale={locale} />}

      {phase === "reveal" && reveal && (
        <RevealScreen
          payload={reveal}
          locale={locale}
          brand={brand}
          appUrl={appUrl}
          onReset={resetToIdle}
        />
      )}

      {phase === "error" && errorMessage && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="max-w-xl rounded-3xl border border-white/10 bg-neutral-900/80 p-10 text-center shadow-2xl">
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
    case "model_load_failed":
    case "detector_load_failed":
      return "Модель не загрузилась. Проверьте соединение";
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

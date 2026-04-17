"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { BrandTheme } from "@/lib/brand-theme";

export type RevealAlternative = {
  celebrityId: string;
  celebrityPhotoId: string;
  name: string;
  nameRu: string | null;
  photoUrl: string;
  similarity: number;
};

export type RevealPayload = {
  resultId: string;
  similarity: number;
  userPhotoUrl: string;
  celebrity: {
    name: string;
    nameRu: string | null;
    descriptionUz: string | null;
    descriptionRu: string | null;
    descriptionEn: string | null;
    photoUrl: string;
  };
  alternatives?: RevealAlternative[];
};

type Props = {
  payload: RevealPayload;
  locale: Locale;
  brand: BrandTheme;
  appUrl: string;
  idleSeconds?: number;
  onReset: () => void;
};

// Stage timings for the reveal sequence. Total settled ≈ 2.0s, a beat longer
// than the similarity count-up so the number feels like the payoff.
const SCAN_MS = 600;
const CROSSFADE_MS = 900;
const COUNTUP_MS = 1500;

export function RevealScreen({ payload, locale, brand, appUrl, idleSeconds = 20, onReset }: Props) {
  const dict = t(locale);
  const [idleLeft, setIdleLeft] = useState(idleSeconds);
  const [stage, setStage] = useState<"scan" | "crossfade" | "done">("scan");
  const [displayedPct, setDisplayedPct] = useState(0);

  const resultUrl = `${appUrl}/r/${payload.resultId}?brand=${encodeURIComponent(brand.id)}&lang=${locale}`;
  const celebName =
    locale === "ru" ? payload.celebrity.nameRu ?? payload.celebrity.name : payload.celebrity.name;
  const { descriptionUz, descriptionRu, descriptionEn } = payload.celebrity;
  const description =
    locale === "ru"
      ? descriptionRu || descriptionUz || descriptionEn
      : descriptionUz || descriptionRu || descriptionEn;

  // Reveal sequence: scan → crossfade → done. The count-up starts when the
  // crossfade begins so the number feels "revealed" alongside the celebrity.
  useEffect(() => {
    const toCrossfade = setTimeout(() => setStage("crossfade"), SCAN_MS);
    const toDone = setTimeout(() => setStage("done"), SCAN_MS + CROSSFADE_MS);
    return () => {
      clearTimeout(toCrossfade);
      clearTimeout(toDone);
    };
  }, []);

  // Count-up animation: eased from 0 → payload.similarity over COUNTUP_MS,
  // starting at the same moment as the crossfade.
  useEffect(() => {
    const target = Math.max(0, Math.min(100, Math.round(payload.similarity)));
    const start = performance.now() + SCAN_MS;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, elapsed / COUNTUP_MS);
      // Cubic ease-out so the number decelerates as it approaches its resting value.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayedPct(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [payload.similarity]);

  useEffect(() => {
    const id = setInterval(() => {
      setIdleLeft((v) => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (idleLeft <= 0) onReset();
  }, [idleLeft, onReset]);

  const alternatives = payload.alternatives ?? [];

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-brand-gradient font-brand">
      {/* Top badge */}
      <div className="relative z-10 flex items-center justify-between px-10 pt-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-[var(--brand-primary)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
          {dict.match}
        </span>
        <span className="text-xs text-white/40">
          {idleLeft} {dict.secondsLeft}
        </span>
      </div>

      {/* Photo showcase */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6 px-10 pt-6">
        <PhotoPanel
          src={payload.userPhotoUrl}
          label={locale === "ru" ? "Вы" : "Siz"}
          mirror
          align="left"
        />
        <RevealPanel
          userSrc={payload.userPhotoUrl}
          celebSrc={payload.celebrity.photoUrl}
          label={celebName}
          stage={stage}
        />
      </div>

      {/* Top-3 mini-carousel: visible once the reveal has settled */}
      {alternatives.length > 0 && (
        <div
          className="px-10 pt-4 transition-opacity duration-500"
          style={{ opacity: stage === "done" ? 1 : 0 }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/40">
            {locale === "ru" ? "Ты также похож на" : "Shuningdek o'xshaysiz"}
          </p>
          <div className="mt-2 flex items-center gap-3">
            {alternatives.map((alt) => {
              const altName = locale === "ru" ? alt.nameRu ?? alt.name : alt.name;
              return (
                <div
                  key={alt.celebrityId}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={alt.photoUrl}
                    alt={altName}
                    className="h-12 w-12 rounded-xl object-cover"
                  />
                  <div className="max-w-[180px]">
                    <div className="truncate text-sm font-semibold text-white">{altName}</div>
                    <div className="text-xs text-[var(--brand-primary)]">{alt.similarity}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer with match info + QR */}
      <div className="relative z-10 mt-6 flex shrink-0 items-center justify-between gap-10 border-t border-white/5 bg-black/30 px-10 py-8 backdrop-blur">
        <div className="flex items-end gap-8">
          <div
            className="font-brand font-black leading-none text-[var(--brand-primary)] tabular-nums"
            style={{
              fontSize: "clamp(6rem, 13vw, 11rem)",
              textShadow: "0 0 60px var(--brand-primary)",
              transform: stage === "done" ? "scale(1.02)" : "scale(1)",
              transition: "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {displayedPct}
            <span className="text-4xl md:text-6xl">%</span>
          </div>
          <div className="max-w-xl pb-4">
            <div className="text-xs uppercase tracking-[0.2em] text-white/50">
              {dict.similarity}
            </div>
            <div className="mt-1 text-3xl font-bold leading-tight text-white md:text-4xl">
              {celebName}
            </div>
            {description && (
              <p className="mt-2 line-clamp-2 text-base text-white/70 md:text-lg">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 -z-10 scale-125 rounded-3xl bg-[var(--brand-primary)]/30 blur-2xl" />
            <div className="rounded-2xl bg-white p-3 shadow-2xl">
              <QRCodeSVG value={resultUrl} size={160} level="M" />
            </div>
          </div>
          <div className="max-w-[220px]">
            <p className="text-base font-semibold text-white">{dict.scanQr}</p>
            <p className="mt-1 text-xs text-white/50">{resultUrl.replace(/^https?:\/\//, "")}</p>
          </div>
        </div>
      </div>

    </div>
  );
}

function PhotoPanel({
  src,
  label,
  mirror,
  align,
}: {
  src: string;
  label: string;
  mirror?: boolean;
  align: "left" | "right";
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.9)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        className={`h-full w-full object-cover ${mirror ? "scale-x-[-1]" : ""}`}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <div
        className={`absolute bottom-6 ${
          align === "right" ? "right-6 text-right" : "left-6"
        } max-w-[70%] text-3xl font-semibold text-white drop-shadow`}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Right-hand reveal panel. Plays a three-stage sequence:
 *   1. `scan`     — user's selfie (mirrored, heavily blurred) with a scanning
 *                   line sweeping down, building "something is processing" tension.
 *   2. `crossfade`— celebrity photo fades in on top of the blurred selfie.
 *   3. `done`     — celebrity photo fully opaque, scan layer hidden.
 * No real face-morphing — just a tight cross-fade with a scan line. Cheap on
 * CPU and works in any kiosk browser.
 */
function RevealPanel({
  userSrc,
  celebSrc,
  label,
  stage,
}: {
  userSrc: string;
  celebSrc: string;
  label: string;
  stage: "scan" | "crossfade" | "done";
}) {
  const celebOpacity = stage === "scan" ? 0 : 1;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.9)]">
      {/* Base layer: selfie heavily blurred + mirrored, acts as an anticipation frame */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={userSrc}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
        style={{ filter: "blur(28px) brightness(0.55) saturate(1.2)" }}
      />

      {/* Top layer: celebrity photo fading in */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={celebSrc}
        alt={label}
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          opacity: celebOpacity,
          transition: `opacity ${CROSSFADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
      />

      {/* Scanning sweep — only during the scan+crossfade phases */}
      {stage !== "done" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="animate-scan-sweep absolute inset-x-0 h-[22%] bg-gradient-to-b from-transparent via-[var(--brand-primary)]/70 to-transparent mix-blend-screen" />
          <div className="absolute inset-0 bg-[var(--brand-primary)]/5" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <div className="absolute bottom-6 right-6 max-w-[70%] text-right text-3xl font-semibold text-white drop-shadow">
        {label}
      </div>
    </div>
  );
}

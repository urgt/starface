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

  useEffect(() => {
    const toCrossfade = setTimeout(() => setStage("crossfade"), SCAN_MS);
    const toDone = setTimeout(() => setStage("done"), SCAN_MS + CROSSFADE_MS);
    return () => {
      clearTimeout(toCrossfade);
      clearTimeout(toDone);
    };
  }, []);

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
      <div className="relative z-10 flex items-center justify-between px-4 pt-4 tv:px-8 tv:pt-6 tv-hd:px-10 tv-hd:pt-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--brand-primary)] tv:px-4 tv:py-1.5 tv:tracking-[0.25em] tv:text-[11px]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
          {dict.match}
        </span>
        <span className="text-[10px] text-white/40 tv:text-xs">
          {idleLeft} {dict.secondsLeft}
        </span>
      </div>

      {/* Photo showcase: stacked on narrow screens, side-by-side on TV */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 px-4 pt-3 tv:gap-6 tv:px-8 tv:pt-6 tv-hd:px-10">
        <PhotoPanel
          src={payload.userPhotoUrl}
          label={locale === "ru" ? "Вы" : "Siz"}
          mirror
          align="left"
        />
        <RevealPanel
          celebSrc={payload.celebrity.photoUrl}
          label={celebName}
          stage={stage}
        />
      </div>

      {/* Top-3 mini-carousel */}
      {alternatives.length > 0 && (
        <div
          className="px-4 pt-3 tv:px-8 tv:pt-4 tv-hd:px-10 transition-opacity duration-500"
          style={{ opacity: stage === "done" ? 1 : 0 }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/40">
            {locale === "ru" ? "Ты также похож на" : "Shuningdek o'xshaysiz"}
          </p>
          <div className="mt-2 flex items-center gap-2 overflow-x-auto tv:gap-3">
            {alternatives.map((alt) => {
              const altName = locale === "ru" ? alt.nameRu ?? alt.name : alt.name;
              return (
                <div
                  key={alt.celebrityId}
                  className="flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2 py-1.5 tv:gap-3 tv:px-3 tv:py-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={alt.photoUrl}
                    alt={altName}
                    loading="lazy"
                    decoding="async"
                    className="h-9 w-9 rounded-xl object-cover tv:h-12 tv:w-12"
                  />
                  <div className="max-w-[140px] tv:max-w-[180px]">
                    <div className="truncate text-xs font-semibold text-white tv:text-sm">
                      {altName}
                    </div>
                    <div className="text-[11px] text-[var(--brand-primary)] tv:text-xs">
                      {alt.similarity}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer with match info + QR */}
      <div className="relative z-10 mt-3 flex shrink-0 flex-col items-start gap-3 border-t border-white/5 bg-black/30 px-4 py-4 tv:mt-6 tv:flex-row tv:items-center tv:justify-between tv:gap-8 tv:px-8 tv:py-6 tv-hd:gap-10 tv-hd:px-10 tv-hd:py-8">
        <div className="flex items-end gap-4 tv:gap-8">
          <div
            className="font-brand font-black leading-none text-[var(--brand-primary)] tabular-nums"
            style={{
              fontSize: "clamp(2.5rem, 12vw, 11rem)",
              transform: stage === "done" ? "scale(1.02)" : "scale(1)",
              transition: "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {displayedPct}
            <span className="text-xl tv:text-4xl tv-hd:text-6xl">%</span>
          </div>
          <div className="max-w-xl pb-2 tv:pb-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/50 tv:text-xs">
              {dict.similarity}
            </div>
            <div className="mt-0.5 text-lg font-bold leading-tight text-white tv:mt-1 tv:text-3xl tv-hd:text-4xl">
              {celebName}
            </div>
            {description && (
              <p className="mt-1 line-clamp-2 text-xs text-white/70 tv:mt-2 tv:text-base tv-hd:text-lg">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 tv:gap-5">
          <div
            className="rounded-xl bg-white p-2 tv:rounded-2xl tv:p-3"
            style={{ width: "clamp(112px, 14vw, 184px)" }}
          >
            <QRCodeSVG
              value={resultUrl}
              level="M"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>
          <div className="max-w-[180px] tv:max-w-[220px]">
            <p className="text-xs font-semibold text-white tv:text-base">{dict.scanQr}</p>
            <p className="mt-0.5 truncate text-[10px] text-white/50 tv:mt-1 tv:text-xs">
              {resultUrl.replace(/^https?:\/\//, "")}
            </p>
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
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40 tv:rounded-3xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        decoding="async"
        className={`h-full w-full object-cover ${mirror ? "scale-x-[-1]" : ""}`}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <div
        className={`absolute bottom-3 tv:bottom-6 ${
          align === "right" ? "right-3 tv:right-6 text-right" : "left-3 tv:left-6"
        } max-w-[70%] text-lg font-semibold text-white tv:text-3xl`}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Right-hand reveal panel. Plays a three-stage sequence:
 *   1. `scan`     — dark background with scan-line sweep (anticipation).
 *   2. `crossfade`— celebrity photo fades in.
 *   3. `done`     — celebrity photo fully opaque, scan layer hidden.
 * The legacy base layer was a 28px CSS-blurred copy of the user selfie.
 * That filter cost ~30-50ms per frame on ARM TVs — the scan-line effect
 * alone carries the anticipation just fine.
 */
function RevealPanel({
  celebSrc,
  label,
  stage,
}: {
  celebSrc: string;
  label: string;
  stage: "scan" | "crossfade" | "done";
}) {
  const celebOpacity = stage === "scan" ? 0 : 1;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/70 tv:rounded-3xl">
      {/* Flat dark base (was a blurred selfie copy — too expensive for TVs). */}
      <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--brand-gradient-from)] to-black" />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={celebSrc}
        alt={label}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          opacity: celebOpacity,
          transition: `opacity ${CROSSFADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
      />

      {stage !== "done" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="animate-scan-sweep absolute inset-x-0 h-[22%] bg-gradient-to-b from-transparent via-[var(--brand-primary)]/70 to-transparent mix-blend-screen" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <div className="absolute bottom-3 right-3 max-w-[70%] text-right text-lg font-semibold text-white tv:bottom-6 tv:right-6 tv:text-3xl">
        {label}
      </div>
    </div>
  );
}

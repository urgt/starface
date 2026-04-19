"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import type { BrandTheme } from "@/lib/brand-theme";
import { LocaleToggle } from "./LocaleToggle";

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
  onLocaleChange: (locale: Locale) => void;
  brand: BrandTheme;
  appUrl: string;
  idleSeconds?: number;
  onReset: () => void;
};

const SCAN_MS = 600;
const CROSSFADE_MS = 900;
const COUNTUP_MS = 1500;

export function RevealScreen({
  payload,
  locale,
  onLocaleChange,
  brand,
  appUrl,
  idleSeconds = 20,
  onReset,
}: Props) {
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
      {/* Top bar: match badge + countdown + locale */}
      <header
        className="relative z-10 flex items-center justify-between"
        style={{
          gap: "var(--kiosk-gap)",
          paddingInline: "var(--kiosk-pad)",
          paddingTop: "var(--kiosk-pad)",
        }}
      >
        <span
          className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-primary)]/40 bg-[var(--brand-primary)]/10 font-semibold uppercase tracking-[0.25em] text-[var(--brand-primary)]"
          style={{
            paddingInline: "clamp(0.75rem, 1.1vw, 1.25rem)",
            paddingBlock: "clamp(0.3rem, 0.5vw, 0.55rem)",
            fontSize: "var(--kiosk-badge-text)",
          }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
          {dict.match}
        </span>
        <div className="flex items-center" style={{ gap: "var(--kiosk-gap)" }}>
          <span className="text-white/40" style={{ fontSize: "var(--kiosk-text-xs)" }}>
            {idleLeft} {dict.secondsLeft}
          </span>
          <LocaleToggle locale={locale} onChange={onLocaleChange} />
        </div>
      </header>

      {/* Photo showcase: always 2 columns — squeezes gracefully via object-cover */}
      <div
        className="grid min-h-0 flex-1 grid-cols-2"
        style={{
          gap: "var(--kiosk-gap)",
          paddingInline: "var(--kiosk-pad)",
          paddingTop: "var(--kiosk-gap)",
        }}
      >
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
          className="transition-opacity duration-500"
          style={{
            opacity: stage === "done" ? 1 : 0,
            paddingInline: "var(--kiosk-pad)",
            paddingTop: "calc(var(--kiosk-gap) * 0.75)",
          }}
        >
          <p
            className="font-semibold uppercase tracking-[0.3em] text-white/40"
            style={{ fontSize: "var(--kiosk-badge-text)" }}
          >
            {locale === "ru" ? "Ты также похож на" : "Shuningdek o'xshaysiz"}
          </p>
          <div
            className="flex items-center overflow-x-auto"
            style={{
              gap: "calc(var(--kiosk-gap) * 0.6)",
              marginTop: "calc(var(--kiosk-gap) * 0.5)",
            }}
          >
            {alternatives.map((alt) => {
              const altName = locale === "ru" ? alt.nameRu ?? alt.name : alt.name;
              return (
                <div
                  key={alt.celebrityId}
                  className="flex shrink-0 items-center rounded-2xl border border-white/10 bg-white/5"
                  style={{
                    gap: "calc(var(--kiosk-gap) * 0.5)",
                    paddingInline: "calc(var(--kiosk-gap) * 0.6)",
                    paddingBlock: "calc(var(--kiosk-gap) * 0.35)",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={alt.photoUrl}
                    alt={altName}
                    loading="lazy"
                    decoding="async"
                    className="rounded-xl object-cover"
                    style={{
                      width: "clamp(2.25rem, 3vw, 3.5rem)",
                      height: "clamp(2.25rem, 3vw, 3.5rem)",
                    }}
                  />
                  <div className="max-w-[clamp(120px,14vw,220px)]">
                    <div
                      className="truncate font-semibold text-white"
                      style={{ fontSize: "var(--kiosk-text-sm)" }}
                    >
                      {altName}
                    </div>
                    <div
                      className="text-[var(--brand-primary)]"
                      style={{ fontSize: "var(--kiosk-text-xs)" }}
                    >
                      {alt.similarity}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer with match info + QR. Grid layout: info | qr on landscape, stacked on narrow. */}
      <div
        className="relative z-10 grid shrink-0 items-center border-t border-white/5 bg-black/30"
        style={{
          marginTop: "var(--kiosk-gap)",
          gap: "var(--kiosk-gap)",
          paddingInline: "var(--kiosk-pad)",
          paddingBlock: "calc(var(--kiosk-gap) * 1.1)",
          gridTemplateColumns: "minmax(0, 1fr) auto",
        }}
      >
        <div
          className="flex min-w-0 items-end"
          style={{ gap: "calc(var(--kiosk-gap) * 1.2)" }}
        >
          <div
            className="font-brand font-black leading-[0.9] text-[var(--brand-primary)] tabular-nums"
            style={{
              fontSize: "var(--kiosk-pct)",
              transform: stage === "done" ? "scale(1.02)" : "scale(1)",
              transition: "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {displayedPct}
            <span style={{ fontSize: "40%" }}>%</span>
          </div>
          <div className="min-w-0 flex-1 pb-[0.4em]">
            <div
              className="uppercase tracking-[0.22em] text-white/50"
              style={{ fontSize: "var(--kiosk-badge-text)" }}
            >
              {dict.similarity}
            </div>
            <div
              className="mt-1 font-bold leading-tight text-white"
              style={{ fontSize: "var(--kiosk-text-2xl)" }}
            >
              {celebName}
            </div>
            {description && (
              <p
                className="mt-1 line-clamp-2 text-white/70"
                style={{ fontSize: "var(--kiosk-text-sm)" }}
              >
                {description}
              </p>
            )}
          </div>
        </div>

        <div
          className="hidden items-center md:flex"
          style={{ gap: "calc(var(--kiosk-gap) * 0.8)" }}
        >
          <div
            className="max-w-[clamp(140px,16vw,260px)]"
            style={{ fontSize: "var(--kiosk-text-sm)" }}
          >
            <p className="font-semibold text-white">{dict.scanQr}</p>
            <p
              className="mt-1 truncate text-white/50"
              style={{ fontSize: "var(--kiosk-text-xs)" }}
            >
              {resultUrl.replace(/^https?:\/\//, "")}
            </p>
          </div>
          <div
            className="rounded-2xl bg-white p-2"
            style={{ width: "var(--kiosk-qr)" }}
          >
            <QRCodeSVG
              value={resultUrl}
              level="M"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
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
    <div
      className="relative overflow-hidden border border-white/10 bg-black/40"
      style={{ borderRadius: "var(--kiosk-radius)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        decoding="async"
        className={`h-full w-full object-cover ${mirror ? "scale-x-[-1]" : ""}`}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
      <div
        className={`absolute ${align === "right" ? "right-0 text-right" : "left-0"} bottom-0 max-w-[70%] font-semibold text-white`}
        style={{
          padding: "calc(var(--kiosk-gap) * 0.85)",
          fontSize: "var(--kiosk-text-xl)",
        }}
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
    <div
      className="relative overflow-hidden border border-white/10 bg-black/70"
      style={{ borderRadius: "var(--kiosk-radius)" }}
    >
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
      <div
        className="absolute bottom-0 right-0 max-w-[70%] text-right font-semibold text-white"
        style={{
          padding: "calc(var(--kiosk-gap) * 0.85)",
          fontSize: "var(--kiosk-text-xl)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

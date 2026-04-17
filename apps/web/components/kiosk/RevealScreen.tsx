"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { Locale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

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
};

type Props = {
  payload: RevealPayload;
  locale: Locale;
  brandId: string;
  appUrl: string;
  idleSeconds?: number;
  onReset: () => void;
};

export function RevealScreen({
  payload,
  locale,
  brandId,
  appUrl,
  idleSeconds = 20,
  onReset,
}: Props) {
  const dict = t(locale);
  const [idleLeft, setIdleLeft] = useState(idleSeconds);

  const resultUrl = `${appUrl}/r/${payload.resultId}?brand=${encodeURIComponent(brandId)}&lang=${locale}`;
  const celebName = locale === "ru" ? payload.celebrity.nameRu ?? payload.celebrity.name : payload.celebrity.name;
  const { descriptionUz, descriptionRu, descriptionEn } = payload.celebrity;
  const description =
    locale === "ru"
      ? descriptionRu || descriptionUz || descriptionEn
      : descriptionUz || descriptionRu || descriptionEn;

  useEffect(() => {
    const id = setInterval(() => {
      setIdleLeft((v) => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (idleLeft <= 0) onReset();
  }, [idleLeft, onReset]);

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-b from-neutral-900 to-black">
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="relative min-h-0 overflow-hidden border-r border-white/10 bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={payload.userPhotoUrl}
            alt="user"
            className="h-full w-full object-contain scale-x-[-1]"
          />
          <div className="absolute bottom-8 left-8 text-2xl text-white/80">Вы</div>
        </div>
        <div className="relative min-h-0 overflow-hidden bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={payload.celebrity.photoUrl} alt={celebName} className="h-full w-full object-contain" />
          <div className="absolute bottom-8 right-8 text-right text-2xl text-white/80">{celebName}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-10 bg-black/60 px-12 py-10 backdrop-blur">
        <div className="animate-scale-in max-w-xl">
          <div className="text-2xl text-neutral-300">{celebName}</div>
          <div className="text-7xl font-black text-[var(--brand-primary)]">
            {payload.similarity}%
          </div>
          <div className="mt-1 text-xl text-neutral-400">{dict.similarity}</div>
          {description && (
            <div className="mt-4 text-2xl font-medium leading-snug text-neutral-100 line-clamp-4">
              {description}
            </div>
          )}
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={resultUrl} size={160} level="M" />
            </div>
            <div className="max-w-[240px]">
              <p className="text-lg text-white">{dict.scanQr}</p>
              <p className="mt-2 text-sm text-neutral-400">
                {idleLeft} {dict.secondsLeft}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

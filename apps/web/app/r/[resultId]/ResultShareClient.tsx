"use client";

import { useEffect, useState } from "react";

type Props = {
  resultId: string;
  brandId: string | null;
  shareUrl: string;
  shareText: string;
  dict: { share: string; telegram: string; copy: string; copied: string };
};

export function ResultShareClient({ resultId, brandId, shareUrl, shareText, dict }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fire({ eventType: "qr_scanned", resultId, brandId });
  }, [resultId, brandId]);

  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      fire({ eventType: "share_clicked", resultId, brandId, metadata: { channel: "copy" } });
    } catch {
      /* ignore */
    }
  };

  const handleTelegram = () => {
    fire({ eventType: "share_clicked", resultId, brandId, metadata: { channel: "telegram" } });
  };

  return (
    <div className="space-y-3">
      <p className="text-center text-sm uppercase tracking-widest text-neutral-500">{dict.share}</p>
      <div className="grid grid-cols-2 gap-3">
        <a
          href={telegramUrl}
          target="_blank"
          rel="noreferrer"
          onClick={handleTelegram}
          className="rounded-xl bg-[var(--brand-primary)] py-3 text-center font-semibold text-white"
        >
          {dict.telegram}
        </a>
        <button
          onClick={handleCopy}
          className="rounded-xl border border-white/15 py-3 font-semibold text-neutral-200"
        >
          {copied ? dict.copied : dict.copy}
        </button>
      </div>
    </div>
  );
}

function fire(body: {
  eventType: string;
  resultId: string;
  brandId: string | null;
  metadata?: Record<string, unknown>;
}) {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

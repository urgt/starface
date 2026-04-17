"use client";

type Props = {
  label: string;
  url: string;
  resultId: string | null;
  brandId: string | null;
};

export function ResultCta({ label, url, resultId, brandId }: Props) {
  const isExternal = url.startsWith("http");
  const handleClick = () => {
    if (!resultId) return;
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "share_clicked",
        resultId,
        brandId,
        metadata: { channel: "cta" },
      }),
      keepalive: true,
    }).catch(() => {});
  };

  return (
    <a
      href={url}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      onClick={handleClick}
      className="mt-6 block rounded-2xl bg-[var(--brand-primary)] py-4 text-center text-base font-bold tracking-tight text-white shadow-[0_10px_40px_-10px_var(--brand-primary)] transition hover:brightness-110"
    >
      {label}
    </a>
  );
}

"use client";

import type { Locale } from "@/lib/i18n";

export function LocaleToggle({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
}) {
  const options: { code: Locale; label: string }[] = [
    { code: "uz", label: "UZ" },
    { code: "ru", label: "RU" },
  ];
  return (
    <div className="inline-flex rounded-full border border-white/15 bg-black/40 p-1 text-sm backdrop-blur">
      {options.map((opt) => (
        <button
          key={opt.code}
          onClick={() => onChange(opt.code)}
          className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
            locale === opt.code ? "bg-white text-black" : "text-white/70 hover:text-white"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

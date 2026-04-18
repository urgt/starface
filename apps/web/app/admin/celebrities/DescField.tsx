"use client";

export function DescField({
  label,
  value,
  onChange,
  onRegenerate,
  regenerating,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-2 font-medium">
        {label}
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            aria-label={`Regenerate ${label} description`}
            title={`Regenerate ${label}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[10px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            {regenerating ? "…" : "↻"}
          </button>
        )}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={regenerating}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
      />
    </label>
  );
}

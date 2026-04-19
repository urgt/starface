"use client";

export function BulkActionBar({
  selectedCount,
  totalOnPage,
  running,
  progress,
  onSelectAll,
  onClear,
  onRegenerate,
  onCancel,
}: {
  selectedCount: number;
  totalOnPage: number;
  running: boolean;
  progress: { done: number; total: number };
  onSelectAll: () => void;
  onClear: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
}) {
  if (!running && selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white/90 px-4 py-2 text-sm shadow-sm backdrop-blur">
      {running ? (
        <>
          <span className="font-medium text-neutral-900">
            Regenerating {progress.done}/{progress.total}…
          </span>
          <div className="ml-auto" />
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium hover:bg-neutral-50"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="font-medium text-neutral-900">{selectedCount} selected</span>
          <button
            type="button"
            onClick={onSelectAll}
            disabled={selectedCount >= totalOnPage}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium hover:bg-neutral-50 disabled:opacity-40"
          >
            Select all on page
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium hover:bg-neutral-50"
          >
            Clear
          </button>
          <div className="ml-auto" />
          <button
            type="button"
            onClick={onRegenerate}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 font-semibold text-white hover:bg-neutral-800"
          >
            Regenerate descriptions
          </button>
        </>
      )}
    </div>
  );
}

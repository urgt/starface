"use client";

import type { MouseEvent } from "react";

import type { CelebrityRow } from "./types";

export type BulkStatus = "pending" | "done" | "error";

export function CelebrityCard({
  celeb,
  onOpen,
  selected,
  onToggleSelect,
  bulkStatus,
  bulkError,
}: {
  celeb: CelebrityRow;
  onOpen: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  bulkStatus: BulkStatus | null;
  bulkError: string | null;
}) {
  const preview = celeb.descriptionUz || celeb.descriptionRu || celeb.descriptionEn || "";
  const primary = celeb.primaryPhotoPath ?? celeb.photos[0]?.photoPath ?? null;
  const locked = bulkStatus === "pending";

  function handleCheckboxClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onToggleSelect();
  }

  return (
    <div
      className={
        "group relative overflow-hidden rounded-xl border bg-white text-left transition-shadow hover:shadow-md " +
        (selected ? "border-neutral-900 ring-2 ring-neutral-900" : "border-neutral-200")
      }
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={selected ? "Deselect" : "Select"}
        onClick={handleCheckboxClick}
        className={
          "absolute left-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold shadow-sm transition-colors " +
          (selected
            ? "border-neutral-900 bg-neutral-900 text-white"
            : "border-neutral-300 bg-white/90 text-transparent hover:border-neutral-500 hover:text-neutral-400")
        }
      >
        ✓
      </button>

      {bulkStatus === "done" && (
        <div className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-md bg-green-600 text-xs font-bold text-white shadow-sm">
          ✓
        </div>
      )}
      {bulkStatus === "error" && (
        <div
          title={bulkError ?? "error"}
          className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-md bg-red-600 text-xs font-bold text-white shadow-sm"
        >
          !
        </div>
      )}

      <button
        type="button"
        onClick={onOpen}
        disabled={locked}
        className="block w-full text-left disabled:cursor-progress"
      >
        {primary ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/files/${primary}`}
            alt={celeb.name}
            className="aspect-square w-full bg-black object-contain"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-neutral-100 text-sm text-neutral-400">
            no photo
          </div>
        )}
        <div className="space-y-1 p-3 text-sm">
          <p className="font-medium text-neutral-900">{celeb.name}</p>
          {celeb.nameRu && <p className="text-xs text-neutral-500">{celeb.nameRu}</p>}
          {preview && (
            <p className="line-clamp-2 pt-1 text-xs text-neutral-600">{preview}</p>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-400">
              {celeb.category ?? "—"}
            </span>
            <span
              className={
                "text-[10px] font-semibold " +
                (celeb.photoCount <= 1
                  ? "text-red-500"
                  : celeb.photoCount < 5
                    ? "text-amber-500"
                    : "text-green-600")
              }
            >
              📷 {celeb.photoCount}
            </span>
          </div>
        </div>
      </button>

      {locked && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/60">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
        </div>
      )}
    </div>
  );
}

"use client";

import type { CelebrityRow } from "./types";

export function CelebrityCard({
  celeb,
  onOpen,
}: {
  celeb: CelebrityRow;
  onOpen: () => void;
}) {
  const preview = celeb.descriptionUz || celeb.descriptionRu || celeb.descriptionEn || "";
  const primary = celeb.primaryPhotoPath ?? celeb.photos[0]?.photoPath ?? null;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-shadow hover:shadow-md">
      <button onClick={onOpen} className="block w-full text-left">
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
    </div>
  );
}

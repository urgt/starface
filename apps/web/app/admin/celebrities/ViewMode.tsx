"use client";

import { PhotoGallery } from "./PhotoGallery";
import type { CelebrityDetail } from "./types";

export function ViewMode({
  detail,
  onEdit,
  onRefresh,
  onDeleted,
}: {
  detail: CelebrityDetail;
  onEdit: () => void;
  onRefresh: () => void;
  onDeleted: () => void;
}) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-neutral-900">{detail.name}</h2>
          {detail.nameRu && <p className="text-neutral-500">{detail.nameRu}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-neutral-500">
            <span className="rounded-full bg-neutral-100 px-2 py-1">{detail.category ?? "—"}</span>
            {!detail.active && (
              <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">inactive</span>
            )}
            <span className="rounded-full bg-neutral-100 px-2 py-1">📷 {detail.photos.length}</span>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Edit
        </button>
      </header>

      <PhotoGallery
        celebrityId={detail.id}
        photos={detail.photos}
        onChanged={onRefresh}
        onDeletedCeleb={onDeleted}
      />

      <Section label="Uzbek" value={detail.descriptionUz} />
      <Section label="Russian" value={detail.descriptionRu} />
      <Section label="English" value={detail.descriptionEn} />

      <footer className="space-y-1 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        <div className="flex items-center justify-between gap-4">
          <span>Created</span>
          <span className="font-mono text-neutral-700">
            {detail.createdAt ? new Date(detail.createdAt).toLocaleString() : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Wikidata</span>
          {detail.wikidataId ? (
            <a
              href={`https://www.wikidata.org/wiki/${detail.wikidataId}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-blue-600 hover:underline"
            >
              {detail.wikidataId}
            </a>
          ) : (
            <span>—</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>ID</span>
          <span className="font-mono text-neutral-700">{detail.id.slice(0, 8)}…</span>
        </div>
      </footer>
    </div>
  );
}

function Section({ label, value }: { label: string; value: string | null }) {
  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
        {value || <span className="text-neutral-400">—</span>}
      </p>
    </section>
  );
}

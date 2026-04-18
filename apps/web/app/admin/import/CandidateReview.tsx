"use client";

import { useMemo, useState } from "react";

import type { CandidateRecord, ImportCategory } from "./types";

function formatYear(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(-?\d{1,4})/.exec(iso);
  return m?.[1] ?? "—";
}

function thumbUrl(imageFile: string | null): string | null {
  if (!imageFile) return null;
  const encoded = encodeURIComponent(imageFile);
  return `/api/admin/fetch-image?url=${encodeURIComponent(
    `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=160`,
  )}`;
}

export function CandidateReview({
  candidates,
  category,
  onBack,
  onStart,
}: {
  candidates: CandidateRecord[];
  category: ImportCategory;
  onBack: () => void;
  onStart: (selected: CandidateRecord[]) => void;
}) {
  const [list, setList] = useState<CandidateRecord[]>(candidates);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      return (
        c.raw.name.toLowerCase().includes(q) ||
        (c.raw.nameRu ?? "").toLowerCase().includes(q) ||
        c.raw.qid.toLowerCase().includes(q) ||
        (c.raw.occupation ?? "").toLowerCase().includes(q)
      );
    });
  }, [list, query]);

  function toggle(qid: string) {
    setList((prev) =>
      prev.map((c) => (c.raw.qid === qid ? { ...c, selected: !c.selected } : c)),
    );
  }

  function setAll(selected: boolean, onlyFiltered: boolean) {
    const visible = new Set(onlyFiltered ? filtered.map((c) => c.raw.qid) : list.map((c) => c.raw.qid));
    setList((prev) =>
      prev.map((c) => (visible.has(c.raw.qid) ? { ...c, selected } : c)),
    );
  }

  const selectedCount = list.filter((c) => c.selected).length;
  const withImage = list.filter((c) => c.raw.imageFile).length;

  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {list.length} candidates · {withImage} with P18 image · category = {category}
          </h2>
          <p className="text-xs text-neutral-500">
            Writes directly to prod. Deselect rows you don&apos;t want. Candidates without a P18
            image will be skipped at import time.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Back
          </button>
          <button
            onClick={() => onStart(list.filter((c) => c.selected))}
            disabled={selectedCount === 0}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Start import ({selectedCount})
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or occupation…"
          className="min-w-[240px] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
        <button
          onClick={() => setAll(true, true)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs"
        >
          Select all visible
        </button>
        <button
          onClick={() => setAll(false, true)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs"
        >
          Deselect all visible
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="w-16 px-3 py-2">Photo</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">QID</th>
              <th className="px-3 py-2">Dates</th>
              <th className="px-3 py-2">Occupation</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const thumb = thumbUrl(c.raw.imageFile);
              return (
                <tr
                  key={c.raw.qid}
                  className={
                    "border-t border-neutral-100 " + (c.selected ? "" : "opacity-50")
                  }
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={() => toggle(c.raw.qid)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {thumb ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={thumb}
                        alt=""
                        className="h-12 w-12 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded bg-neutral-100 text-[9px] text-neutral-400">
                        no P18
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.raw.name}</div>
                    {c.raw.nameRu && (
                      <div className="text-xs text-neutral-500">{c.raw.nameRu}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`https://www.wikidata.org/wiki/${c.raw.qid}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-blue-600 hover:underline"
                    >
                      {c.raw.qid}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {formatYear(c.raw.dob)}–{c.raw.dod ? formatYear(c.raw.dod) : ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {c.raw.occupation ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

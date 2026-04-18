"use client";

import { useCallback, useEffect, useState } from "react";

import { detectAndEmbed, FaceEmbedError } from "@/lib/face-embed";
import { readFileAsBase64 } from "./upload-helpers";

type PhotoCandidate = {
  id: string;
  fileName: string;
  fullUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  sourceUrl: string;
  sourceType: "p18" | "category";
  license: string | null;
};

type CandidateState = {
  candidate: PhotoCandidate;
  selected: boolean;
  status: "idle" | "fetching" | "embedding" | "uploading" | "done" | "failed";
  error?: string;
};

function extFromContentType(ct: string): "jpg" | "jpeg" | "png" | "webp" {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg")) return "jpeg";
  return "jpg";
}

export function FindPhotosModal({
  celebrityId,
  onClose,
  onImported,
}: {
  celebrityId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateState[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/celebrities/${celebrityId}/photo-candidates`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { candidates?: PhotoCandidate[] };
      setCandidates(
        (data.candidates ?? []).map((c) => ({
          candidate: c,
          selected: false,
          status: "idle" as const,
        })),
      );
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [celebrityId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setCandidates((list) =>
      list.map((c) => (c.candidate.id === id ? { ...c, selected: !c.selected } : c)),
    );
  }

  async function processOne(index: number): Promise<void> {
    const current = candidates[index];
    if (!current) return;
    const update = (patch: Partial<CandidateState>) =>
      setCandidates((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));

    try {
      update({ status: "fetching", error: undefined });
      const imgRes = await fetch(
        `/api/admin/fetch-image?url=${encodeURIComponent(current.candidate.fullUrl)}`,
      );
      if (!imgRes.ok) throw new Error(`fetch-image HTTP ${imgRes.status}`);
      const blob = await imgRes.blob();
      const file = new File([blob], current.candidate.fileName, { type: blob.type });

      update({ status: "embedding" });
      const bitmap = await createImageBitmap(blob);
      let result;
      try {
        result = await detectAndEmbed(bitmap);
      } finally {
        bitmap.close();
      }
      const base64 = await readFileAsBase64(file);
      const ext = extFromContentType(blob.type);

      update({ status: "uploading" });
      const uploadRes = await fetch(`/api/admin/celebrities/${celebrityId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: [
            {
              imageBase64: base64,
              imageExt: ext,
              embedding: result.embedding,
              detScore: result.detScore,
              faceQuality: result.faceQuality,
              source: "commons",
              sourceUrl: current.candidate.sourceUrl,
            },
          ],
        }),
      });
      if (!uploadRes.ok) throw new Error(`upload HTTP ${uploadRes.status}`);

      update({ status: "done" });
    } catch (e) {
      const code = e instanceof FaceEmbedError ? e.code : (e as Error).message;
      update({ status: "failed", error: code });
    }
  }

  async function runImport() {
    setRunning(true);
    const indices = candidates
      .map((c, i) => (c.selected && c.status !== "done" ? i : -1))
      .filter((i) => i >= 0);
    for (const i of indices) {
      await processOne(i);
    }
    setRunning(false);
    onImported();
  }

  const selectedCount = candidates.filter((c) => c.selected).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="close"
          className="absolute right-3 top-3 z-10 rounded-full bg-black/70 p-2 text-white hover:bg-black"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="max-h-[94vh] overflow-y-auto p-6">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Find more photos (Wikimedia Commons)</h2>
            <button
              onClick={runImport}
              disabled={running || selectedCount === 0}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {running ? "Importing…" : `Import ${selectedCount} selected`}
            </button>
          </header>

          {loading && <p className="text-neutral-500">Loading candidates…</p>}
          {loadError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {loadError}
            </p>
          )}
          {!loading && !loadError && candidates.length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-400">
              No Wikidata-backed candidates. Set a Wikidata ID on the celebrity first.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {candidates.map((c) => (
              <div
                key={c.candidate.id}
                className={
                  "group relative overflow-hidden rounded-xl border bg-black transition-colors " +
                  (c.selected ? "border-neutral-900" : "border-neutral-200")
                }
              >
                <button
                  type="button"
                  onClick={() => toggle(c.candidate.id)}
                  disabled={running}
                  className="block w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.candidate.thumbUrl}
                    alt={c.candidate.fileName}
                    className="aspect-square w-full object-contain"
                  />
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                    {c.candidate.sourceType}
                  </span>
                  {c.selected && (
                    <span className="absolute right-2 top-2 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                      ✓
                    </span>
                  )}
                  {c.status !== "idle" && (
                    <span
                      className={
                        "absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white " +
                        (c.status === "done"
                          ? "bg-green-600"
                          : c.status === "failed"
                            ? "bg-red-600"
                            : "bg-blue-600")
                      }
                    >
                      {c.status === "failed" ? `✗ ${c.error ?? ""}` : c.status}
                    </span>
                  )}
                </button>
                <div className="space-y-0.5 p-2 text-[10px] text-neutral-700">
                  <p className="truncate font-mono" title={c.candidate.fileName}>
                    {c.candidate.fileName}
                  </p>
                  <p className="text-neutral-500">
                    {c.candidate.width}×{c.candidate.height}
                    {c.candidate.license ? ` · ${c.candidate.license}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

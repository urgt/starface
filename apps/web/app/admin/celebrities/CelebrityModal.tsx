"use client";

import { useCallback, useEffect, useState } from "react";

import { EditMode } from "./EditMode";
import type { CelebrityDetail } from "./types";
import { ViewMode } from "./ViewMode";

export function CelebrityModal({
  celebrityId,
  initialName,
  onClose,
}: {
  celebrityId: string;
  initialName: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CelebrityDetail | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/celebrities/${celebrityId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CelebrityDetail;
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [celebrityId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

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
          {loading && <p className="text-neutral-500">Loading…</p>}
          {error && <p className="text-red-600">Error: {error}</p>}
          {detail && mode === "view" && (
            <ViewMode
              detail={detail}
              onEdit={() => setMode("edit")}
              onRefresh={load}
              onDeleted={onClose}
            />
          )}
          {detail && mode === "edit" && (
            <EditMode
              detail={detail}
              onCancel={() => setMode("view")}
              onSaved={async () => {
                await load();
                setMode("view");
              }}
              onRefresh={load}
              onDeleted={onClose}
            />
          )}
          {!detail && !loading && !error && (
            <p className="text-neutral-500">No data ({initialName}).</p>
          )}
        </div>
      </div>
    </div>
  );
}

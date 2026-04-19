"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BulkActionBar } from "./BulkActionBar";
import { CelebrityCard, type BulkStatus } from "./CelebrityCard";
import { CelebrityModal } from "./CelebrityModal";
import type { CelebrityRow } from "./types";

export type { CelebrityPhotoMini, CelebrityRow } from "./types";

const CONCURRENCY = 3;
const DONE_BADGE_MS = 2500;

type Toast = { text: string; tone: "success" | "error" };

export function CelebritiesList({ celebrities }: { celebrities: CelebrityRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<Map<string, BulkStatus>>(() => new Map());
  const [bulkErrors, setBulkErrors] = useState<Map<string, string>>(() => new Map());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [toast, setToast] = useState<Toast | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const doneTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const celebById = useMemo(() => {
    const m = new Map<string, CelebrityRow>();
    for (const c of celebrities) m.set(c.id, c);
    return m;
  }, [celebrities]);

  // Reset selection + transient state when the celebrities list (page) changes.
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkStatus(new Map());
    setBulkErrors(new Map());
    for (const t of doneTimersRef.current.values()) clearTimeout(t);
    doneTimersRef.current.clear();
  }, [celebrities]);

  useEffect(() => {
    const timers = doneTimersRef.current;
    return () => {
      abortRef.current?.abort();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(celebrities.map((c) => c.id)));
  }, [celebrities]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const setStatus = useCallback((id: string, status: BulkStatus | null, error?: string) => {
    setBulkStatus((prev) => {
      const next = new Map(prev);
      if (status === null) next.delete(id);
      else next.set(id, status);
      return next;
    });
    setBulkErrors((prev) => {
      const next = new Map(prev);
      if (error) next.set(id, error);
      else next.delete(id);
      return next;
    });
  }, []);

  async function runBulk() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const initial = new Map<string, BulkStatus>();
    for (const id of ids) initial.set(id, "pending");
    setBulkStatus(initial);
    setBulkErrors(new Map());
    setProgress({ done: 0, total: ids.length });
    setRunning(true);

    let ok = 0;
    let failed = 0;
    let cursor = 0;

    async function worker() {
      while (true) {
        if (controller.signal.aborted) return;
        const i = cursor++;
        if (i >= ids.length) return;
        const id = ids[i];
        try {
          const res = await fetch(`/api/admin/celebrities/${id}/generate-description`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: controller.signal,
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
              detail?: string;
            };
            const msg = data.detail ?? data.error ?? `HTTP ${res.status}`;
            setStatus(id, "error", msg);
            failed++;
          } else {
            setStatus(id, "done");
            ok++;
            const timer = setTimeout(() => {
              setStatus(id, null);
              doneTimersRef.current.delete(id);
            }, DONE_BADGE_MS);
            doneTimersRef.current.set(id, timer);
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          setStatus(id, "error", (e as Error).message);
          failed++;
        } finally {
          if (!controller.signal.aborted) {
            setProgress((p) => ({ ...p, done: p.done + 1 }));
          }
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker());
    await Promise.all(workers);

    if (controller.signal.aborted) {
      // Drop pending overlays for items that never started.
      setBulkStatus((prev) => {
        const next = new Map(prev);
        for (const [id, s] of prev) if (s === "pending") next.delete(id);
        return next;
      });
      setToast({ text: `Cancelled. ${ok} ok, ${failed} failed.`, tone: "error" });
    } else {
      setToast({
        text: `Done: ${ok} ok, ${failed} failed.`,
        tone: failed > 0 ? "error" : "success",
      });
    }

    setRunning(false);
    abortRef.current = null;
    router.refresh();
  }

  function cancelBulk() {
    abortRef.current?.abort();
  }

  const openCeleb = openId ? celebById.get(openId) ?? null : null;

  return (
    <div className="space-y-4">
      <BulkActionBar
        selectedCount={selectedIds.size}
        totalOnPage={celebrities.length}
        running={running}
        progress={progress}
        onSelectAll={selectAll}
        onClear={clearSelection}
        onRegenerate={runBulk}
        onCancel={cancelBulk}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {celebrities.map((c) => (
          <CelebrityCard
            key={c.id}
            celeb={c}
            selected={selectedIds.has(c.id)}
            onToggleSelect={() => toggleSelect(c.id)}
            bulkStatus={bulkStatus.get(c.id) ?? null}
            bulkError={bulkErrors.get(c.id) ?? null}
            onOpen={() => setOpenId(c.id)}
          />
        ))}
        {celebrities.length === 0 && (
          <p className="col-span-full rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-400">
            Nothing matches the filter.
          </p>
        )}
      </div>

      {openCeleb && (
        <CelebrityModal
          celebrityId={openCeleb.id}
          initialName={openCeleb.name}
          onClose={() => {
            setOpenId(null);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div
          className={
            "fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg " +
            (toast.tone === "success" ? "bg-green-600" : "bg-neutral-900")
          }
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

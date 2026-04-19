"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BulkActionBar, type BulkAction } from "./BulkActionBar";
import { CelebrityCard, type BulkStatus } from "./CelebrityCard";
import { CelebrityModal } from "./CelebrityModal";
import { BULK_PHOTO_CONCURRENCY, findPhotosForCeleb } from "./bulk-photos";
import type { CelebrityRow } from "./types";

export type { CelebrityPhotoMini, CelebrityRow } from "./types";

const DESC_CONCURRENCY = 3;
const DONE_BADGE_MS = 2500;

type Toast = { text: string; tone: "success" | "error" };

type ItemOutcome =
  | { kind: "done"; label?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; message: string };

export function CelebritiesList({ celebrities }: { celebrities: CelebrityRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<Map<string, BulkStatus>>(() => new Map());
  const [bulkErrors, setBulkErrors] = useState<Map<string, string>>(() => new Map());
  const [bulkLabels, setBulkLabels] = useState<Map<string, string>>(() => new Map());
  const [runningAction, setRunningAction] = useState<BulkAction | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [toast, setToast] = useState<Toast | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const doneTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const celebById = useMemo(() => {
    const m = new Map<string, CelebrityRow>();
    for (const c of celebrities) m.set(c.id, c);
    return m;
  }, [celebrities]);

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkStatus(new Map());
    setBulkErrors(new Map());
    setBulkLabels(new Map());
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

  function applyOutcome(id: string, outcome: ItemOutcome) {
    setBulkStatus((prev) => {
      const next = new Map(prev);
      next.set(id, outcome.kind);
      return next;
    });
    setBulkErrors((prev) => {
      const next = new Map(prev);
      if (outcome.kind === "skipped") next.set(id, outcome.reason);
      else if (outcome.kind === "error") next.set(id, outcome.message);
      else next.delete(id);
      return next;
    });
    setBulkLabels((prev) => {
      const next = new Map(prev);
      if (outcome.kind === "done" && outcome.label) next.set(id, outcome.label);
      else next.delete(id);
      return next;
    });

    if (outcome.kind === "done") {
      const timer = setTimeout(() => {
        setBulkStatus((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setBulkLabels((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        doneTimersRef.current.delete(id);
      }, DONE_BADGE_MS);
      doneTimersRef.current.set(id, timer);
    }
  }

  async function runPool(
    action: BulkAction,
    concurrency: number,
    perItem: (id: string, signal: AbortSignal) => Promise<ItemOutcome>,
  ) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const initial = new Map<string, BulkStatus>();
    for (const id of ids) initial.set(id, "pending");
    setBulkStatus(initial);
    setBulkErrors(new Map());
    setBulkLabels(new Map());
    setProgress({ done: 0, total: ids.length });
    setRunningAction(action);

    const counts = { done: 0, skipped: 0, failed: 0 };
    let cursor = 0;

    async function worker() {
      while (true) {
        if (controller.signal.aborted) return;
        const i = cursor++;
        if (i >= ids.length) return;
        const id = ids[i];
        let outcome: ItemOutcome;
        try {
          outcome = await perItem(id, controller.signal);
        } catch (e) {
          if (controller.signal.aborted) return;
          outcome = { kind: "error", message: (e as Error).message };
        }
        if (controller.signal.aborted) return;
        applyOutcome(id, outcome);
        if (outcome.kind === "done") counts.done++;
        else if (outcome.kind === "skipped") counts.skipped++;
        else counts.failed++;
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, () =>
      worker(),
    );
    await Promise.all(workers);

    if (controller.signal.aborted) {
      setBulkStatus((prev) => {
        const next = new Map(prev);
        for (const [id, s] of prev) if (s === "pending") next.delete(id);
        return next;
      });
      setToast({
        text: `Cancelled. ${counts.done} ok, ${counts.skipped} skipped, ${counts.failed} failed.`,
        tone: "error",
      });
    } else {
      const text =
        action === "descriptions"
          ? `Done: ${counts.done} ok, ${counts.failed} failed.`
          : `Added photos for ${counts.done} celebs. ${counts.skipped} skipped, ${counts.failed} failed.`;
      setToast({
        text,
        tone: counts.failed > 0 ? "error" : "success",
      });
    }

    setRunningAction(null);
    abortRef.current = null;
    router.refresh();
  }

  async function runRegenerateDescriptions() {
    await runPool("descriptions", DESC_CONCURRENCY, async (id, signal) => {
      const res = await fetch(`/api/admin/celebrities/${id}/generate-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ save: true }),
        signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const msg = data.detail ?? data.error ?? `HTTP ${res.status}`;
        console.error("regenerate-description failed", { celebrityId: id, msg });
        return { kind: "error", message: msg };
      }
      return { kind: "done" };
    });
  }

  async function runFindPhotos() {
    await runPool("photos", BULK_PHOTO_CONCURRENCY, async (id, signal) => {
      const outcome = await findPhotosForCeleb(id, signal);
      if (outcome.kind === "added") {
        return { kind: "done", label: `+${outcome.count}` };
      }
      return outcome;
    });
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
        runningAction={runningAction}
        progress={progress}
        onSelectAll={selectAll}
        onClear={clearSelection}
        onRegenerateDescriptions={runRegenerateDescriptions}
        onFindPhotos={runFindPhotos}
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
            bulkDoneLabel={bulkLabels.get(c.id) ?? null}
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type JobDto = {
  id: string;
  celebrity_id: string;
  name: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  error?: string | null;
  uz_preview?: string | null;
  sources?: string[];
  created_at?: number;
  started_at?: number | null;
  finished_at?: number | null;
};

type Snapshot = {
  queued: number;
  running: number;
  done: number;
  error: number;
  cancelled: number;
  workers: number;
  active: JobDto[];
  recent: JobDto[];
};

const EMPTY: Snapshot = {
  queued: 0,
  running: 0,
  done: 0,
  error: 0,
  cancelled: 0,
  workers: 2,
  active: [],
  recent: [],
};

export function QueuePanel() {
  const router = useRouter();
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = snap.queued + snap.running + snap.done + snap.error + snap.cancelled;
  const busy = snap.queued + snap.running > 0;

  const activeRecent = useMemo(() => {
    const active = [...snap.active];
    const recent = snap.recent.filter((j) => !active.find((a) => a.id === j.id));
    return [...active, ...recent].slice(0, 50);
  }, [snap.active, snap.recent]);

  useEffect(() => {
    const controller = new AbortController();
    let buf = "";
    let stopped = false;
    const applyEvent = (event: string, data: string) => {
      if (!data) return;
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      if (event === "snapshot") {
        setSnap(payload as unknown as Snapshot);
        return;
      }
      if (event === "ping") return;
      const job = (payload.job ?? payload) as JobDto | undefined;
      if (!job?.id) return;
      setSnap((prev) => mergeJob(prev, job));
      if (event === "finished" && job.status === "done") {
        // Nudge current page to pick up the new description.
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => router.refresh(), 1000);
      }
    };

    async function run() {
      while (!stopped) {
        try {
          const res = await fetch("/api/admin/describe/events", { signal: controller.signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          setConnected(true);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const chunks = buf.split("\n\n");
            buf = chunks.pop() ?? "";
            for (const chunk of chunks) {
              let event = "message";
              let data = "";
              for (const line of chunk.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
              }
              applyEvent(event, data);
            }
          }
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          setConnected(false);
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    run();
    return () => {
      stopped = true;
      controller.abort();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [router]);

  async function cancelAll() {
    await fetch("/api/admin/describe/cancel", { method: "POST" });
  }

  if (total === 0 && !busy) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(96vw,480px)] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 bg-neutral-900 px-4 py-3 text-left text-sm font-semibold text-white"
      >
        <span className="flex items-center gap-2">
          <span className={"h-2 w-2 rounded-full " + (busy ? "bg-yellow-400 animate-pulse" : "bg-green-400")} />
          Description queue
          <span className="text-xs font-normal text-white/70">
            ({snap.workers} worker{snap.workers > 1 ? "s" : ""})
          </span>
          {!connected && <span className="text-xs font-normal text-red-300">(disconnected)</span>}
        </span>
        <span className="flex items-center gap-3 text-xs">
          <Badge color="yellow" label="queued" value={snap.queued} />
          <Badge color="blue" label="running" value={snap.running} />
          <Badge color="green" label="done" value={snap.done} />
          {snap.error > 0 && <Badge color="red" label="err" value={snap.error} />}
          <svg width="12" height="12" viewBox="0 0 12 12" className={open ? "rotate-180" : ""}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="max-h-[60vh] space-y-2 overflow-auto p-3">
          {snap.queued + snap.running > 0 && (
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <p className="text-xs text-neutral-500">
                {snap.running} running · {snap.queued} queued
              </p>
              <button
                onClick={cancelAll}
                className="rounded-lg border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700"
              >
                Cancel queued
              </button>
            </div>
          )}
          {activeRecent.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
          {activeRecent.length === 0 && (
            <p className="py-4 text-center text-sm text-neutral-400">No jobs yet</p>
          )}
        </div>
      )}
    </div>
  );
}

function mergeJob(prev: Snapshot, job: JobDto): Snapshot {
  const replaceIn = (arr: JobDto[]) => {
    const next = arr.filter((j) => j.id !== job.id);
    return next;
  };
  const active = replaceIn(prev.active);
  const recent = replaceIn(prev.recent);
  if (job.status === "queued" || job.status === "running") {
    active.unshift(job);
  } else {
    recent.unshift(job);
    if (recent.length > 100) recent.pop();
  }
  // Recompute counts across merged state.
  const all = [...active, ...recent];
  const count = (s: JobDto["status"]) => all.filter((j) => j.status === s).length;
  return {
    ...prev,
    active,
    recent,
    queued: count("queued"),
    running: count("running"),
    done: Math.max(prev.done, count("done")),
    error: Math.max(prev.error, count("error")),
    cancelled: Math.max(prev.cancelled, count("cancelled")),
  };
}

function JobRow({ job }: { job: JobDto }) {
  const colorMap: Record<JobDto["status"], string> = {
    queued: "bg-yellow-100 text-yellow-800",
    running: "bg-blue-100 text-blue-800 animate-pulse",
    done: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-700",
    cancelled: "bg-neutral-100 text-neutral-500",
  };
  const icon: Record<JobDto["status"], string> = {
    queued: "⏸",
    running: "⏵",
    done: "✓",
    error: "✗",
    cancelled: "⊘",
  };
  return (
    <div className="rounded-lg border border-neutral-100 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-neutral-900">{job.name}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${colorMap[job.status]}`}>
          {icon[job.status]} {job.status}
        </span>
      </div>
      {job.uz_preview && (
        <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{job.uz_preview}</p>
      )}
      {job.error && <p className="mt-1 text-xs text-red-600">{job.error}</p>}
    </div>
  );
}

function Badge({
  color,
  label,
  value,
}: {
  color: "yellow" | "blue" | "green" | "red";
  label: string;
  value: number;
}) {
  const cls = {
    yellow: "bg-yellow-400/20 text-yellow-200",
    blue: "bg-blue-400/20 text-blue-200",
    green: "bg-green-400/20 text-green-200",
    red: "bg-red-400/20 text-red-200",
  }[color];
  return (
    <span className={"rounded-full px-2 py-0.5 font-mono " + cls}>
      {label}: {value}
    </span>
  );
}

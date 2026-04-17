"use client";

import { useRef, useState } from "react";

const CATEGORIES = ["uz", "cis", "world", "all"] as const;
type Category = (typeof CATEGORIES)[number];

type PhaseName = "fetch" | "enroll" | "generate";

type PhaseState = {
  name: PhaseName;
  title: string;
  status: "pending" | "running" | "done" | "error";
  rc?: number;
};

export function ImportSection() {
  const [category, setCategory] = useState<Category>("uz");
  const [limit, setLimit] = useState<string>("50");
  const [skipFetch, setSkipFetch] = useState(false);
  const [skipEnroll, setSkipEnroll] = useState(false);
  const [skipGenerate, setSkipGenerate] = useState(false);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [phases, setPhases] = useState<PhaseState[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const appendLine = (s: string) => setLines((p) => [...p, s]);

  async function start() {
    if (running) return;
    setRunning(true);
    setLines([]);
    setPhases([]);
    abortRef.current = new AbortController();

    const body: Record<string, unknown> = { category, skipFetch, skipEnroll, skipGenerate };
    const lim = parseInt(limit, 10);
    if (!Number.isNaN(lim) && lim > 0) body.limit = lim;

    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        appendLine(`✗ HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          let event = "message";
          let data = "";
          for (const l of part.split("\n")) {
            if (l.startsWith("event: ")) event = l.slice(7);
            else if (l.startsWith("data: ")) data += l.slice(6);
          }
          if (!data) continue;
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }

          if (event === "start") {
            appendLine(`→ start: category=${payload.category} limit=${payload.limit ?? "default"}`);
          } else if (event === "phase") {
            const name = payload.name as PhaseName;
            const title = (payload.title as string) ?? name;
            setPhases((p) => [...p, { name, title, status: "running" }]);
            appendLine(`\n▶ ${title}`);
          } else if (event === "log") {
            appendLine(String(payload.line ?? ""));
          } else if (event === "phase_done") {
            const name = payload.name as PhaseName;
            const rc = payload.rc as number;
            setPhases((p) =>
              p.map((x) =>
                x.name === name ? { ...x, status: rc === 0 ? "done" : "error", rc } : x,
              ),
            );
            appendLine(rc === 0 ? `  ✓ ${name} finished` : `  ✗ ${name} rc=${rc}`);
          } else if (event === "done") {
            appendLine(payload.ok ? "\n═══ ✓ Import complete" : "\n═══ ✗ Import aborted");
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        appendLine(`✗ ${(e as Error).message}`);
      } else {
        appendLine("\n═══ aborted");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6">
      <header>
        <h2 className="text-lg font-semibold">Import celebrities</h2>
        <p className="text-sm text-neutral-500">
          Fetch photos from Wikidata/Commons → enroll face embeddings → generate UZ/RU/EN
          descriptions via LM Studio. Mirrors <code>./scripts/seed.sh</code>. Runs inside the ML
          container; this page streams live progress.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Category</span>
          <div className="inline-flex rounded-lg border border-neutral-300 bg-white p-1 text-sm">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                disabled={running}
                className={
                  "rounded-md px-3 py-1 font-medium capitalize transition-colors " +
                  (category === c
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:text-neutral-900")
                }
              >
                {c}
              </button>
            ))}
          </div>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Limit (per category)</span>
          <input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="50"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            disabled={running}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipFetch}
            onChange={(e) => setSkipFetch(e.target.checked)}
            disabled={running}
          />
          skip fetch
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipEnroll}
            onChange={(e) => setSkipEnroll(e.target.checked)}
            disabled={running}
          />
          skip enroll
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipGenerate}
            onChange={(e) => setSkipGenerate(e.target.checked)}
            disabled={running}
          />
          skip generate descriptions
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={start}
          disabled={running}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {running ? "Running…" : "Start import"}
        </button>
        {running && (
          <button
            onClick={stop}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700"
          >
            Stop
          </button>
        )}
      </div>

      {phases.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {phases.map((p) => (
            <span
              key={p.name}
              className={
                "rounded-full px-3 py-1 font-medium " +
                (p.status === "done"
                  ? "bg-green-100 text-green-800"
                  : p.status === "error"
                  ? "bg-red-100 text-red-700"
                  : p.status === "running"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-neutral-100 text-neutral-600")
              }
            >
              {p.status === "running" && "⏵ "}
              {p.status === "done" && "✓ "}
              {p.status === "error" && "✗ "}
              {p.title}
            </span>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-black p-3 font-mono text-xs text-green-200">
          {lines.join("\n")}
        </pre>
      )}
    </section>
  );
}

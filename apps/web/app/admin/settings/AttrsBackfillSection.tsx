"use client";

import { useState } from "react";

type Result = {
  total: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export function AttrsBackfillSection() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/enrich-attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const text = await res.text();
      if (!res.ok) {
        setError(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        return;
      }
      setResult(JSON.parse(text) as Result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-bold">Face attributes back-fill</h2>
      <p className="mt-1 text-sm text-neutral-500">
        Reads <code>face.sex</code> / <code>face.age</code> from each celebrity&apos;s primary
        photo (InsightFace buffalo_l) and writes them to <code>celebrities.gender</code>/
        <code>celebrities.age</code>. Used by <code>/api/match</code> to penalise
        gender/age mismatches during re-rank. Idempotent &mdash; only processes rows where
        the fields are still NULL.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={running}
          onClick={run}
          className="rounded-lg bg-indigo-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-800 disabled:opacity-60"
        >
          {running ? "Running…" : "Back-fill now"}
        </button>
        {running && (
          <span className="text-xs text-neutral-500">
            ~200ms per celebrity. Leave the page open while it runs.
          </span>
        )}
      </div>
      {result && (
        <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <div className="font-semibold text-neutral-700">
            Updated {result.updated} / {result.total} &middot; skipped {result.skipped}
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-500">
                {result.errors.length} error{result.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-neutral-600">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

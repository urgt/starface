"use client";

import { useState } from "react";

import { PRESETS } from "@/lib/wikidata-presets";
import type { RawCandidate } from "@/lib/wikidata-query";
import type { ImportCategory } from "./types";

export function PresetPicker({
  onResults,
}: {
  onResults: (rows: RawCandidate[], category: ImportCategory) => void;
}) {
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [customSparql, setCustomSparql] = useState("");
  const [customCategory, setCustomCategory] = useState<ImportCategory>("uz");
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [limit, setLimit] = useState(50);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setRunning(true);
    setError(null);
    try {
      const body =
        mode === "preset"
          ? { preset: presetId, limit }
          : { sparql: customSparql, limit };
      const res = await fetch("/api/admin/wikidata-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        candidates?: RawCandidate[];
        error?: string;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const category: ImportCategory =
        mode === "preset"
          ? (PRESETS.find((p) => p.id === presetId)?.category ?? "uz")
          : customCategory;
      onResults(data.candidates ?? [], category);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="inline-flex rounded-lg border border-neutral-300 bg-white p-1 text-sm">
        {(["preset", "custom"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "rounded-md px-3 py-1 font-medium transition-colors " +
              (mode === m
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:text-neutral-900")
            }
          >
            {m === "preset" ? "Preset" : "Custom SPARQL"}
          </button>
        ))}
      </div>

      {mode === "preset" && (
        <div className="space-y-2">
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">
            {PRESETS.find((p) => p.id === presetId)?.description}
          </p>
        </div>
      )}

      {mode === "custom" && (
        <div className="space-y-2">
          <textarea
            value={customSparql}
            onChange={(e) => setCustomSparql(e.target.value)}
            rows={8}
            placeholder={`SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel WHERE { ... } LIMIT {{LIMIT}}`}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs"
          />
          <label className="block text-xs">
            <span className="mb-1 block font-medium">Category for imported celebrities</span>
            <select
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value as ImportCategory)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2"
            >
              <option value="uz">uz</option>
              <option value="cis">cis</option>
              <option value="world">world</option>
            </select>
          </label>
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Limit</span>
        <input
          type="number"
          min={1}
          max={500}
          value={limit}
          onChange={(e) =>
            setLimit(Math.max(1, Math.min(500, Number(e.target.value))))
          }
          className="w-32 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <button
        onClick={() => void submit()}
        disabled={running || (mode === "custom" && customSparql.trim().length === 0)}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? "Running…" : "Run query"}
      </button>
    </div>
  );
}

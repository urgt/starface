"use client";

import { useState } from "react";

type Initial = {
  baseUrl: string;
  apiKeyMasked: string;
  model: string;
};

export function SettingsForm({ initial }: { initial: Initial }) {
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initial.model);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; latencyMs: number } | { ok: false; error: string } | null
  >(null);

  async function save() {
    setSaving(true);
    setSavedAt(null);
    try {
      const body: Record<string, string> = { baseUrl, model };
      if (apiKey) body.apiKey = apiKey;
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSavedAt(new Date().toLocaleTimeString());
      setApiKey("");
    } catch (e) {
      alert("Save failed: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/settings/llm/test", { method: "POST" });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6">
      <header>
        <h2 className="text-lg font-semibold">LLM (OpenAI-compatible)</h2>
        <p className="text-sm text-neutral-500">
          Used by the admin «Regenerate descriptions» buttons. The Python CLI picks up the same
          values from the database.
        </p>
      </header>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Base URL</span>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:1234/v1"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={initial.apiKeyMasked || "••••"}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm"
        />
        <span className="mt-1 block text-xs text-neutral-500">
          Current: <code>{initial.apiKeyMasked || "(not set)"}</code>. Leave blank to keep.
        </span>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Model</span>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="google/gemma-4-e4b"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50"
        >
          {testing ? "Testing..." : "Test connection"}
        </button>
        {savedAt && <span className="text-sm text-green-700">Saved at {savedAt}</span>}
        {testResult?.ok && (
          <span className="text-sm text-green-700">✓ OK ({testResult.latencyMs}ms)</span>
        )}
        {testResult && !testResult.ok && (
          <span className="text-sm text-red-600">✗ {testResult.error}</span>
        )}
      </div>
    </section>
  );
}

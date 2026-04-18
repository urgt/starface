"use client";

import { useState } from "react";

import { DescField } from "./DescField";
import { PhotoGallery } from "./PhotoGallery";
import type { CelebrityDetail } from "./types";

type GenLang = "uz" | "ru" | "en";
type GenTarget = "all" | GenLang;

export function EditMode({
  detail,
  onCancel,
  onSaved,
  onRefresh,
  onDeleted,
}: {
  detail: CelebrityDetail;
  onCancel: () => void;
  onSaved: () => void;
  onRefresh: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(detail.name);
  const [nameRu, setNameRu] = useState(detail.nameRu ?? "");
  const [category, setCategory] = useState<string>(detail.category ?? "uz");
  const [descUz, setDescUz] = useState(detail.descriptionUz ?? "");
  const [descRu, setDescRu] = useState(detail.descriptionRu ?? "");
  const [descEn, setDescEn] = useState(detail.descriptionEn ?? "");
  const [wikidataId, setWikidataId] = useState(detail.wikidataId ?? "");
  const [active, setActive] = useState(detail.active);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [genTarget, setGenTarget] = useState<GenTarget | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSource, setGenSource] = useState<"wikipedia" | "none" | null>(null);

  async function generate(target: GenTarget) {
    const languages: GenLang[] | undefined = target === "all" ? undefined : [target];
    setGenTarget(target);
    setGenError(null);
    try {
      const res = await fetch(`/api/admin/celebrities/${detail.id}/generate-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(languages ? { languages } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        uz?: string;
        ru?: string;
        en?: string;
        source?: "wikipedia" | "none";
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        setGenError(
          data.error === "rate_limited"
            ? "Rate limited, try again in a moment."
            : data.error === "safety_blocked"
              ? "Gemini blocked the response (safety filter)."
              : data.error === "upstream_error"
                ? "Gemini API error. Try again."
                : (data.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      if (data.uz) setDescUz(data.uz);
      if (data.ru) setDescRu(data.ru);
      if (data.en) setDescEn(data.en);
      setGenSource(data.source ?? null);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setGenTarget(null);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/celebrities/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          nameRu: nameRu || null,
          category: category || null,
          descriptionUz: descUz || null,
          descriptionRu: descRu || null,
          descriptionEn: descEn || null,
          wikidataId: wikidataId || null,
          active,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      alert("Save failed: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteCeleb() {
    if (!confirm(`Delete celebrity "${detail.name}" and all their photos permanently?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/celebrities/${detail.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted();
    } catch (e) {
      alert("Delete failed: " + (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-bold">Edit celebrity</h2>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <PhotoGallery
        celebrityId={detail.id}
        photos={detail.photos}
        onChanged={onRefresh}
        editable
        onDeletedCeleb={onDeleted}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name (Latin)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name (Russian)</span>
          <input
            value={nameRu}
            onChange={(e) => setNameRu(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="uz">uz</option>
            <option value="cis">cis</option>
            <option value="world">world</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Wikidata ID</span>
          <input
            value={wikidataId}
            onChange={(e) => setWikidataId(e.target.value)}
            placeholder="Q12345"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span className="font-medium">Active</span>
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Descriptions
          </h3>
          <div className="flex items-center gap-2">
            {genSource && !genError && (
              <span className="text-xs text-neutral-500">
                {genSource === "wikipedia"
                  ? "Generated from Wikipedia"
                  : "Generated from name only"}
              </span>
            )}
            <button
              type="button"
              onClick={() => void generate("all")}
              disabled={genTarget !== null}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {genTarget === "all" ? "Generating…" : "Generate descriptions"}
            </button>
          </div>
        </div>
        {genError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {genError}
          </p>
        )}
        <DescField
          label="Uzbek"
          value={descUz}
          onChange={setDescUz}
          onRegenerate={() => void generate("uz")}
          regenerating={genTarget === "uz" || genTarget === "all"}
        />
        <DescField
          label="Russian"
          value={descRu}
          onChange={setDescRu}
          onRegenerate={() => void generate("ru")}
          regenerating={genTarget === "ru" || genTarget === "all"}
        />
        <DescField
          label="English"
          value={descEn}
          onChange={setDescEn}
          onRegenerate={() => void generate("en")}
          regenerating={genTarget === "en" || genTarget === "all"}
        />
      </div>

      <div className="border-t border-red-200 pt-4">
        <button
          onClick={deleteCeleb}
          disabled={deleting}
          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Delete celebrity"}
        </button>
      </div>
    </div>
  );
}

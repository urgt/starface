"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { detectAndEmbed, FaceEmbedError } from "@/lib/face-embed";

export type CelebrityPhotoMini = {
  id: string;
  photoPath: string;
  isPrimary: boolean;
  faceQuality: string | null;
};

export type CelebrityRow = {
  id: string;
  name: string;
  nameRu: string | null;
  category: string | null;
  descriptionUz: string | null;
  descriptionRu: string | null;
  descriptionEn: string | null;
  wikidataId: string | null;
  active: boolean | null;
  createdAt: string | null;
  photos: CelebrityPhotoMini[];
  primaryPhotoPath: string | null;
  photoCount: number;
};

export function CelebritiesList({ celebrities }: { celebrities: CelebrityRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<CelebrityRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {celebrities.map((c) => (
          <CelebrityCard key={c.id} celeb={c} onOpen={() => setSelected(c)} />
        ))}
        {celebrities.length === 0 && (
          <p className="col-span-full rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-400">
            Nothing matches the filter.
          </p>
        )}
      </div>

      {selected && (
        <CelebrityModal
          celebrityId={selected.id}
          initialName={selected.name}
          onClose={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CelebrityCard({ celeb, onOpen }: { celeb: CelebrityRow; onOpen: () => void }) {
  const preview = celeb.descriptionUz || celeb.descriptionRu || celeb.descriptionEn || "";
  const primary = celeb.primaryPhotoPath ?? celeb.photos[0]?.photoPath ?? null;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition-shadow hover:shadow-md">
      <button onClick={onOpen} className="block w-full text-left">
        {primary ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/files/${primary}`}
            alt={celeb.name}
            className="aspect-square w-full bg-black object-contain"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-neutral-100 text-sm text-neutral-400">
            no photo
          </div>
        )}
        <div className="space-y-1 p-3 text-sm">
          <p className="font-medium text-neutral-900">{celeb.name}</p>
          {celeb.nameRu && <p className="text-xs text-neutral-500">{celeb.nameRu}</p>}
          {preview && (
            <p className="line-clamp-2 pt-1 text-xs text-neutral-600">{preview}</p>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-400">
              {celeb.category ?? "—"}
            </span>
            <span
              className={
                "text-[10px] font-semibold " +
                (celeb.photoCount <= 1
                  ? "text-red-500"
                  : celeb.photoCount < 5
                    ? "text-amber-500"
                    : "text-green-600")
              }
            >
              📷 {celeb.photoCount}
            </span>
          </div>
        </div>
      </button>
    </div>
  );
}

type CelebrityDetail = {
  id: string;
  name: string;
  nameRu: string | null;
  category: string | null;
  descriptionUz: string | null;
  descriptionRu: string | null;
  descriptionEn: string | null;
  wikidataId: string | null;
  active: boolean;
  createdAt: string | null;
  photos: Array<{
    id: string;
    photoUrl: string;
    photoPath: string;
    isPrimary: boolean;
    faceQuality: string | null;
    detScore: number | null;
  }>;
};

function CelebrityModal({
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

function ViewMode({
  detail,
  onEdit,
  onRefresh,
  onDeleted,
}: {
  detail: CelebrityDetail;
  onEdit: () => void;
  onRefresh: () => void;
  onDeleted: () => void;
}) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-neutral-900">{detail.name}</h2>
          {detail.nameRu && <p className="text-neutral-500">{detail.nameRu}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-neutral-500">
            <span className="rounded-full bg-neutral-100 px-2 py-1">{detail.category ?? "—"}</span>
            {!detail.active && (
              <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">inactive</span>
            )}
            <span className="rounded-full bg-neutral-100 px-2 py-1">📷 {detail.photos.length}</span>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Edit
        </button>
      </header>

      <PhotoGallery
        celebrityId={detail.id}
        photos={detail.photos}
        onChanged={onRefresh}
        onDeletedCeleb={onDeleted}
      />

      <Section label="Uzbek" value={detail.descriptionUz} />
      <Section label="Russian" value={detail.descriptionRu} />
      <Section label="English" value={detail.descriptionEn} />

      <footer className="space-y-1 border-t border-neutral-200 pt-4 text-xs text-neutral-500">
        <div className="flex items-center justify-between gap-4">
          <span>Created</span>
          <span className="font-mono text-neutral-700">
            {detail.createdAt ? new Date(detail.createdAt).toLocaleString() : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Wikidata</span>
          {detail.wikidataId ? (
            <a
              href={`https://www.wikidata.org/wiki/${detail.wikidataId}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-blue-600 hover:underline"
            >
              {detail.wikidataId}
            </a>
          ) : (
            <span>—</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>ID</span>
          <span className="font-mono text-neutral-700">{detail.id.slice(0, 8)}…</span>
        </div>
      </footer>
    </div>
  );
}

function EditMode({
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

  type GenLang = "uz" | "ru" | "en";
  type GenTarget = "all" | GenLang;

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

function DescField({
  label,
  value,
  onChange,
  onRegenerate,
  regenerating,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-2 font-medium">
        {label}
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            aria-label={`Regenerate ${label} description`}
            title={`Regenerate ${label}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[10px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            {regenerating ? "…" : "↻"}
          </button>
        )}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={regenerating}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
      />
    </label>
  );
}

function Section({ label, value }: { label: string; value: string | null }) {
  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">
        {value || <span className="text-neutral-400">—</span>}
      </p>
    </section>
  );
}

async function fileToBitmap(file: File): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function PhotoGallery({
  celebrityId,
  photos,
  onChanged,
  editable = false,
  onDeletedCeleb,
}: {
  celebrityId: string;
  photos: CelebrityDetail["photos"];
  onChanged: () => void;
  editable?: boolean;
  onDeletedCeleb?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadLog([`→ processing ${files.length} file(s)…`]);
    const payloads: Array<{
      imageBase64: string;
      imageExt: "jpg" | "jpeg" | "png" | "webp";
      embedding: number[];
      detScore: number;
      faceQuality: "high" | "medium";
    }> = [];

    for (const file of Array.from(files)) {
      try {
        const bitmap = await fileToBitmap(file);
        const result = await detectAndEmbed(bitmap);
        bitmap.close();
        const base64 = await readFileAsBase64(file);
        const rawExt = (file.name.split(".").pop() || "jpg").toLowerCase();
        const ext: "jpg" | "jpeg" | "png" | "webp" =
          rawExt === "png" ? "png" : rawExt === "webp" ? "webp" : rawExt === "jpeg" ? "jpeg" : "jpg";
        payloads.push({
          imageBase64: base64,
          imageExt: ext,
          embedding: result.embedding,
          detScore: result.detScore,
          faceQuality: result.faceQuality,
        });
        setUploadLog((p) => [...p, `✓ ${file.name} (quality: ${result.faceQuality})`]);
      } catch (e) {
        const code = e instanceof FaceEmbedError ? e.code : (e as Error).message;
        setUploadLog((p) => [...p, `✗ ${file.name} — ${code}`]);
      }
    }

    if (payloads.length === 0) {
      setUploading(false);
      return;
    }

    try {
      const res = await fetch(`/api/admin/celebrities/${celebrityId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: payloads }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        results: Array<{ status: string; error?: string }>;
      };
      const okCount = data.results.filter((r) => r.status === "ok").length;
      setUploadLog((p) => [...p, `→ saved ${okCount}/${data.results.length}`]);
      onChanged();
    } catch (e) {
      setUploadLog((p) => [...p, `✗ upload failed: ${(e as Error).message}`]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function setPrimary(photoId: string) {
    const res = await fetch(`/api/admin/celebrities/${celebrityId}/photos/${photoId}/primary`, {
      method: "POST",
    });
    if (!res.ok) {
      alert("Set primary failed: " + res.status);
      return;
    }
    onChanged();
  }

  async function remove(photoId: string) {
    const res = await fetch(`/api/admin/celebrities/${celebrityId}/photos/${photoId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (data.error === "last_photo") {
        if (
          confirm(
            "This is the only photo. Delete the whole celebrity?\n" +
              "Click OK to delete, Cancel to keep.",
          )
        ) {
          const delRes = await fetch(`/api/admin/celebrities/${celebrityId}`, {
            method: "DELETE",
          });
          if (delRes.ok && onDeletedCeleb) onDeletedCeleb();
          return;
        }
        return;
      }
      alert("Delete photo failed: " + (data.message ?? res.status));
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Photos ({photos.length})
        </h3>
        {editable && (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => upload(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "+ Add photos"}
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((p) => (
          <div
            key={p.id}
            className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-black"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photoUrl} alt="celebrity" className="aspect-square w-full object-contain" />
            {p.isPrimary && (
              <span className="absolute left-2 top-2 rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-900">
                ★ primary
              </span>
            )}
            {p.faceQuality && (
              <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                {p.faceQuality}
              </span>
            )}
            {editable && (
              <div className="absolute inset-x-2 top-10 flex items-center justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {!p.isPrimary && (
                  <button
                    onClick={() => setPrimary(p.id)}
                    className="rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-neutral-900"
                  >
                    ★ primary
                  </button>
                )}
                <button
                  onClick={() => remove(p.id)}
                  className="ml-auto rounded-full bg-red-600 px-2 py-1 text-[10px] font-semibold text-white"
                >
                  delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {uploadLog.length > 0 && (
        <pre className="max-h-40 overflow-auto rounded-lg bg-neutral-50 p-2 text-xs text-neutral-700">
          {uploadLog.join("\n")}
        </pre>
      )}
    </div>
  );
}

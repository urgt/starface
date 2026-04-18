"use client";

import { useRef, useState } from "react";

import { detectAndEmbed, FaceEmbedError } from "@/lib/face-embed";
import type { CelebrityDetail } from "./types";
import { fileToBitmap, readFileAsBase64 } from "./upload-helpers";

export function PhotoGallery({
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

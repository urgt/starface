"use client";

import { detectAndEmbed, FaceEmbedError } from "@/lib/face-embed";

import { readFileAsBase64 } from "./upload-helpers";

export const BULK_PHOTO_TARGET = 5;
export const BULK_PHOTO_SIMILARITY = 0.5;
export const BULK_PHOTO_CONCURRENCY = 2;

export type PhotoCandidate = {
  id: string;
  fileName: string;
  fullUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
  sourceUrl: string;
  sourceType: "p18" | "category";
  license: string | null;
};

type CandidatesResponse = {
  candidates: PhotoCandidate[];
  primaryEmbedding: number[] | null;
  currentPhotoCount: number;
};

export type FindPhotosOutcome =
  | { kind: "added"; count: number }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; message: string };

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function extFromContentType(ct: string): "jpg" | "jpeg" | "png" | "webp" {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg")) return "jpeg";
  return "jpg";
}

type UploadPhoto = {
  imageBase64: string;
  imageExt: "jpg" | "jpeg" | "png" | "webp";
  embedding: number[];
  detScore: number;
  faceQuality: "high" | "medium";
  source: "commons";
  sourceUrl: string;
};

async function processCandidate(
  candidate: PhotoCandidate,
  primaryEmbedding: number[],
  signal: AbortSignal,
): Promise<{ ok: true; photo: UploadPhoto } | { ok: false }> {
  const imgRes = await fetch(
    `/api/admin/fetch-image?url=${encodeURIComponent(candidate.fullUrl)}`,
    { signal },
  );
  if (!imgRes.ok) return { ok: false };
  const blob = await imgRes.blob();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return { ok: false };
  }

  try {
    const result = await detectAndEmbed(bitmap);
    const similarity = cosine(result.embedding, primaryEmbedding);
    if (similarity < BULK_PHOTO_SIMILARITY) return { ok: false };

    const file = new File([blob], candidate.fileName, { type: blob.type });
    const imageBase64 = await readFileAsBase64(file);

    return {
      ok: true,
      photo: {
        imageBase64,
        imageExt: extFromContentType(blob.type),
        embedding: result.embedding,
        detScore: result.detScore,
        faceQuality: result.faceQuality,
        source: "commons",
        sourceUrl: candidate.sourceUrl,
      },
    };
  } catch (e) {
    if (e instanceof FaceEmbedError) return { ok: false };
    throw e;
  } finally {
    bitmap.close();
  }
}

export async function findPhotosForCeleb(
  celebrityId: string,
  signal: AbortSignal,
): Promise<FindPhotosOutcome> {
  const res = await fetch(`/api/admin/celebrities/${celebrityId}/photo-candidates`, {
    signal,
  });
  if (!res.ok) {
    return { kind: "error", message: `candidates HTTP ${res.status}` };
  }
  const data = (await res.json()) as CandidatesResponse;

  if (!data.primaryEmbedding) {
    return { kind: "skipped", reason: "no primary embedding" };
  }
  const slotsLeft = BULK_PHOTO_TARGET - data.currentPhotoCount;
  if (slotsLeft <= 0) {
    return { kind: "skipped", reason: "already full" };
  }
  if (data.candidates.length === 0) {
    return { kind: "skipped", reason: "no candidates" };
  }

  const accepted: UploadPhoto[] = [];
  for (const candidate of data.candidates) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    if (accepted.length >= slotsLeft) break;
    try {
      const out = await processCandidate(candidate, data.primaryEmbedding, signal);
      if (out.ok) accepted.push(out.photo);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      // non-abort candidate-level errors are swallowed; keep trying others
    }
  }

  if (accepted.length === 0) {
    return { kind: "skipped", reason: "no identity match" };
  }

  const uploadRes = await fetch(`/api/admin/celebrities/${celebrityId}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos: accepted }),
    signal,
  });
  if (!uploadRes.ok) {
    const body = (await uploadRes.json().catch(() => ({}))) as { error?: string };
    return {
      kind: "error",
      message: body.error ?? `upload HTTP ${uploadRes.status}`,
    };
  }

  return { kind: "added", count: accepted.length };
}

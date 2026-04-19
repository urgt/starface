"use client";

import type { FaceDetector } from "@mediapipe/tasks-vision";

// All heavy ML runs on Modal via /api/embed. MediaPipe stays as a lightweight
// UX gate so admin tools can probe a face before uploading. The kiosk does not
// use the detector — so we keep MediaPipe behind a dynamic import to avoid
// pulling a ~2MB WASM chunk into the kiosk bundle.

export type FaceEmbedCode =
  | "no_face"
  | "multiple_faces"
  | "low_quality"
  | "model_load_failed"
  | "detector_load_failed"
  | "server_unavailable"
  | "internal";

export class FaceEmbedError extends Error {
  code: FaceEmbedCode;
  constructor(code: FaceEmbedCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export type EmbedResult = {
  embedding: number[];
  bbox: [number, number, number, number];
  detScore: number;
  faceQuality: "high" | "medium";
  sex: "M" | "F" | null;
  age: number | null;
};

// Pinned to match the installed @mediapipe/tasks-vision dependency. Using
// @latest can silently pull a runtime incompatible with the installed types.
export const MEDIAPIPE_VERSION = "0.10.34";
export const MEDIAPIPE_WASM_ROOT =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_ROOT ??
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

const DETECTOR_MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_DETECTOR_URL ??
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const EMBED_ENDPOINT = "/api/embed";
const EMBED_BURST_ENDPOINT = "/api/embed/burst";

let detectorPromise: Promise<FaceDetector> | null = null;

async function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
        return await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: DETECTOR_MODEL_URL, delegate: "GPU" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5,
        });
      } catch (e) {
        detectorPromise = null;
        throw new FaceEmbedError("detector_load_failed", (e as Error).message);
      }
    })();
  }
  return detectorPromise;
}

async function bitmapToJpegBlob(bitmap: ImageBitmap, quality = 0.92): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new FaceEmbedError("internal", "canvas_ctx_failed");
  ctx.drawImage(bitmap, 0, 0);
  return await canvas.convertToBlob({ type: "image/jpeg", quality });
}

function errorFromResponse(status: number, body: unknown): FaceEmbedError {
  const code = (body as { error?: string } | null)?.error ?? `http_${status}`;
  if (
    code === "no_face" ||
    code === "multiple_faces" ||
    code === "low_quality" ||
    code === "detector_load_failed" ||
    code === "model_load_failed"
  ) {
    return new FaceEmbedError(code as FaceEmbedCode);
  }
  if (status >= 500 || status === 0) {
    return new FaceEmbedError("server_unavailable", code);
  }
  return new FaceEmbedError("internal", code);
}

async function parseEmbedResponse(res: Response): Promise<EmbedResult> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw errorFromResponse(res.status, body);
  }
  const data = (await res.json()) as EmbedResult;
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new FaceEmbedError("internal", "bad_response_shape");
  }
  return data;
}

export async function detectAndEmbed(source: ImageBitmap): Promise<EmbedResult> {
  // getDetector() warms up MediaPipe before the embed call so admin tools that
  // import many photos in sequence don't re-initialize WASM per photo.
  await getDetector();
  const blob = await bitmapToJpegBlob(source);
  const form = new FormData();
  form.append("image", blob, "frame.jpg");
  let res: Response;
  try {
    res = await fetch(EMBED_ENDPOINT, { method: "POST", body: form });
  } catch (e) {
    throw new FaceEmbedError("server_unavailable", (e as Error).message);
  }
  return parseEmbedResponse(res);
}

export async function embedBurst(frames: Blob[]): Promise<EmbedResult> {
  if (frames.length === 0) throw new FaceEmbedError("no_face");
  const form = new FormData();
  frames.forEach((b, i) => form.append("images", b, `frame-${i}.jpg`));
  let res: Response;
  try {
    res = await fetch(EMBED_BURST_ENDPOINT, { method: "POST", body: form });
  } catch (e) {
    throw new FaceEmbedError("server_unavailable", (e as Error).message);
  }
  return parseEmbedResponse(res);
}

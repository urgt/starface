"use client";

import {
  FaceDetector,
  FilesetResolver,
  type Detection,
} from "@mediapipe/tasks-vision";

// All heavy ML runs on Modal via /api/embed. MediaPipe stays as a lightweight
// UX gate so the kiosk can tell the user "лицо не видно" before the shutter.

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

const DETECTOR_MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_DETECTOR_URL ??
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const WASM_ROOT =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_ROOT ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const EMBED_ENDPOINT = "/api/embed";
const EMBED_BURST_ENDPOINT = "/api/embed/burst";

let detectorPromise: Promise<FaceDetector> | null = null;

async function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
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

export type FaceGateResult = {
  detections: Detection[];
  score: number;
};

/** Cheap UX-only face check. Does NOT embed — call detectAndEmbed for that. */
export async function probeFace(source: ImageBitmap): Promise<FaceGateResult> {
  const detector = await getDetector();
  const result = detector.detect(source);
  const detections = result.detections ?? [];
  const score = detections[0]?.categories?.[0]?.score ?? 0;
  return { detections, score };
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

export async function embedBurst(frames: ImageBitmap[]): Promise<EmbedResult> {
  if (frames.length === 0) throw new FaceEmbedError("no_face");
  const blobs = await Promise.all(frames.map((f) => bitmapToJpegBlob(f)));
  const form = new FormData();
  blobs.forEach((b, i) => form.append("images", b, `frame-${i}.jpg`));
  let res: Response;
  try {
    res = await fetch(EMBED_BURST_ENDPOINT, { method: "POST", body: form });
  } catch (e) {
    throw new FaceEmbedError("server_unavailable", (e as Error).message);
  }
  return parseEmbedResponse(res);
}

export async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

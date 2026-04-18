"use client";

import {
  FaceDetector,
  FilesetResolver,
  type Detection,
} from "@mediapipe/tasks-vision";
import * as ort from "onnxruntime-web";

export type FaceEmbedCode =
  | "no_face"
  | "multiple_faces"
  | "low_quality"
  | "model_load_failed"
  | "detector_load_failed"
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
};

const MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_MODEL_URL ?? "/api/files/models/mobilefacenet.onnx";
const DETECTOR_MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_DETECTOR_URL ??
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const WASM_ROOT =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_ROOT ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const EMBEDDING_DIM = 512;
const FACE_SIZE = 112;

let detectorPromise: Promise<FaceDetector> | null = null;
let sessionPromise: Promise<ort.InferenceSession> | null = null;

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

async function fetchModelBuffer(): Promise<ArrayBuffer> {
  const cacheKey = new Request(MODEL_URL);
  const cache = await caches.open("starface-face-model-v1");
  let response = await cache.match(cacheKey);
  if (!response) {
    const net = await fetch(MODEL_URL);
    if (!net.ok) throw new FaceEmbedError("model_load_failed", `HTTP ${net.status}`);
    await cache.put(cacheKey, net.clone());
    response = net;
  }
  return await response.arrayBuffer();
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      try {
        const buffer = await fetchModelBuffer();
        return await ort.InferenceSession.create(buffer, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        });
      } catch (e) {
        sessionPromise = null;
        if (e instanceof FaceEmbedError) throw e;
        throw new FaceEmbedError("model_load_failed", (e as Error).message);
      }
    })();
  }
  return sessionPromise;
}

type AlignedPatch = { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D };

function getAlignedCanvas(): AlignedPatch {
  const canvas = new OffscreenCanvas(FACE_SIZE, FACE_SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new FaceEmbedError("internal", "canvas_ctx_failed");
  return { canvas, ctx };
}

function alignFace(
  source: ImageBitmap,
  detection: Detection,
): { imageData: ImageData; bbox: [number, number, number, number]; faceQuality: "high" | "medium" } {
  const bbox = detection.boundingBox;
  if (!bbox) throw new FaceEmbedError("internal", "missing_bbox");

  const x = Math.max(0, bbox.originX);
  const y = Math.max(0, bbox.originY);
  const w = Math.min(source.width - x, bbox.width);
  const h = Math.min(source.height - y, bbox.height);

  const margin = 0.25;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = (Math.max(w, h) * (1 + margin)) / 2;
  const sx = Math.max(0, cx - half);
  const sy = Math.max(0, cy - half);
  const sw = Math.min(source.width - sx, half * 2);
  const sh = Math.min(source.height - sy, half * 2);

  const keypoints = detection.keypoints ?? [];
  let angle = 0;
  if (keypoints.length >= 2) {
    const leftEye = keypoints[0];
    const rightEye = keypoints[1];
    const dx = (rightEye.x - leftEye.x) * source.width;
    const dy = (rightEye.y - leftEye.y) * source.height;
    angle = Math.atan2(dy, dx);
  }

  const { canvas, ctx } = getAlignedCanvas();
  ctx.save();
  ctx.translate(FACE_SIZE / 2, FACE_SIZE / 2);
  ctx.rotate(-angle);
  const scale = FACE_SIZE / sw;
  ctx.scale(scale, scale);
  ctx.translate(-(cx - sx), -(cy - sy));
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();

  const faceQuality: "high" | "medium" =
    Math.min(w, h) >= 96 && (detection.categories?.[0]?.score ?? 0) >= 0.85 ? "high" : "medium";

  return {
    imageData: ctx.getImageData(0, 0, FACE_SIZE, FACE_SIZE),
    bbox: [x, y, w, h],
    faceQuality,
  };
}

function imageDataToTensor(imageData: ImageData): ort.Tensor {
  const { data } = imageData;
  const tensor = new Float32Array(3 * FACE_SIZE * FACE_SIZE);
  const plane = FACE_SIZE * FACE_SIZE;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    tensor[i] = (r - 127.5) / 128;
    tensor[plane + i] = (g - 127.5) / 128;
    tensor[2 * plane + i] = (b - 127.5) / 128;
  }
  return new ort.Tensor("float32", tensor, [1, 3, FACE_SIZE, FACE_SIZE]);
}

function l2normalize(vec: Float32Array | number[]): number[] {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

export async function detectAndEmbed(source: ImageBitmap): Promise<EmbedResult> {
  const detector = await getDetector();
  const result = detector.detect(source);
  const detections = result.detections ?? [];
  if (detections.length === 0) throw new FaceEmbedError("no_face");
  if (detections.length > 1) throw new FaceEmbedError("multiple_faces");

  const detection = detections[0];
  const detScore = detection.categories?.[0]?.score ?? 0;
  if (detScore < 0.6) throw new FaceEmbedError("low_quality");

  const { imageData, bbox, faceQuality } = alignFace(source, detection);
  const session = await getSession();
  const tensor = imageDataToTensor(imageData);
  const inputName = session.inputNames[0];
  const outputs = await session.run({ [inputName]: tensor });
  const first = outputs[session.outputNames[0]];
  const values = first.data as Float32Array;
  if (values.length !== EMBEDDING_DIM) {
    throw new FaceEmbedError("internal", `unexpected_dim_${values.length}`);
  }
  const embedding = l2normalize(values);

  return { embedding, bbox, detScore, faceQuality };
}

export async function embedBurst(frames: ImageBitmap[]): Promise<EmbedResult> {
  const results: EmbedResult[] = [];
  const errors: FaceEmbedError[] = [];
  for (const frame of frames) {
    try {
      results.push(await detectAndEmbed(frame));
    } catch (e) {
      if (e instanceof FaceEmbedError) errors.push(e);
      else errors.push(new FaceEmbedError("internal", (e as Error).message));
    }
  }
  if (results.length === 0) throw errors[0] ?? new FaceEmbedError("no_face");

  const summed = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const r of results) {
    for (let i = 0; i < EMBEDDING_DIM; i++) summed[i] += r.embedding[i];
  }
  const embedding = l2normalize(summed);

  const best = results.reduce((a, b) => (a.detScore >= b.detScore ? a : b));
  return {
    embedding,
    bbox: best.bbox,
    detScore: best.detScore,
    faceQuality: results.every((r) => r.faceQuality === "high") ? "high" : "medium",
  };
}

export async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

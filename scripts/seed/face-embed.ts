import { existsSync } from "node:fs";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

import { config } from "./config.ts";

export type FaceEmbedResult = {
  embedding: number[];
  bbox: [number, number, number, number];
  detScore: number;
  faceQuality: "high" | "medium";
};

export type FaceEmbedErrorCode =
  | "no_face"
  | "multiple_faces"
  | "low_quality"
  | "image_decode_failed"
  | "internal";

export class FaceEmbedError extends Error {
  code: FaceEmbedErrorCode;
  constructor(code: FaceEmbedErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

const FACE_SIZE = 112;
const EMBEDDING_DIM = 512;
const YUNET_INPUT = 640;

let facenetSessionPromise: Promise<ort.InferenceSession> | null = null;
let yunetSessionPromise: Promise<ort.InferenceSession> | null = null;

function loadSession(path: string, label: string): Promise<ort.InferenceSession> {
  if (!existsSync(path)) {
    throw new FaceEmbedError("internal", `${label} model not found at ${path}`);
  }
  return ort.InferenceSession.create(path, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
}

function getFacenetSession(): Promise<ort.InferenceSession> {
  if (!facenetSessionPromise) {
    facenetSessionPromise = loadSession(config.facenetModelPath, "mobilefacenet");
  }
  return facenetSessionPromise;
}

function getYunetSession(): Promise<ort.InferenceSession> {
  if (!yunetSessionPromise) {
    yunetSessionPromise = loadSession(config.yunetModelPath, "yunet");
  }
  return yunetSessionPromise;
}

type RawDetection = {
  bbox: [number, number, number, number];
  score: number;
  keypoints: [number, number][];
};

async function detectFaces(buffer: Buffer): Promise<{ width: number; height: number; faces: RawDetection[] }> {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new FaceEmbedError("image_decode_failed");

  const scale = Math.min(YUNET_INPUT / width, YUNET_INPUT / height);
  const resizedW = Math.round(width * scale);
  const resizedH = Math.round(height * scale);

  const padded = await image
    .clone()
    .resize(resizedW, resizedH, { fit: "contain", background: "#000000" })
    .extend({
      top: 0,
      left: 0,
      bottom: YUNET_INPUT - resizedH,
      right: YUNET_INPUT - resizedW,
      background: "#000000",
    })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer();

  const session = await getYunetSession();
  const input = new Float32Array(3 * YUNET_INPUT * YUNET_INPUT);
  const plane = YUNET_INPUT * YUNET_INPUT;
  for (let i = 0; i < plane; i++) {
    input[i] = padded[i * 3 + 2];
    input[plane + i] = padded[i * 3 + 1];
    input[2 * plane + i] = padded[i * 3];
  }
  const tensor = new ort.Tensor("float32", input, [1, 3, YUNET_INPUT, YUNET_INPUT]);
  const inputName = session.inputNames[0];
  const outputs = await session.run({ [inputName]: tensor });

  const faces = decodeYunet(outputs, YUNET_INPUT, scale);
  return { width, height, faces };
}

function decodeYunet(
  outputs: ort.InferenceSession.OnnxValueMapType,
  inputSize: number,
  scale: number,
): RawDetection[] {
  const strides = [8, 16, 32];
  const result: RawDetection[] = [];
  for (const stride of strides) {
    const clsName = Object.keys(outputs).find((n) => n === `cls_${stride}` || n === `conf_${stride}`);
    const objName = Object.keys(outputs).find((n) => n === `obj_${stride}`);
    const bboxName = Object.keys(outputs).find((n) => n === `bbox_${stride}` || n === `loc_${stride}`);
    const kpsName = Object.keys(outputs).find((n) => n === `kps_${stride}` || n === `landmark_${stride}`);
    if (!clsName || !bboxName) continue;

    const cls = outputs[clsName].data as Float32Array;
    const obj = objName ? (outputs[objName].data as Float32Array) : null;
    const bbox = outputs[bboxName].data as Float32Array;
    const kps = kpsName ? (outputs[kpsName].data as Float32Array) : null;

    const gridSize = inputSize / stride;
    const count = gridSize * gridSize;
    for (let i = 0; i < count; i++) {
      const clsScore = cls[i];
      const objScore = obj ? obj[i] : 1;
      const score = clsScore * objScore;
      if (score < 0.6) continue;

      const gridY = Math.floor(i / gridSize);
      const gridX = i % gridSize;
      const cx = (gridX + bbox[i * 4]) * stride;
      const cy = (gridY + bbox[i * 4 + 1]) * stride;
      const w = Math.exp(bbox[i * 4 + 2]) * stride;
      const h = Math.exp(bbox[i * 4 + 3]) * stride;

      const x1 = (cx - w / 2) / scale;
      const y1 = (cy - h / 2) / scale;
      const bw = w / scale;
      const bh = h / scale;

      const landmarks: [number, number][] = [];
      if (kps) {
        for (let k = 0; k < 5; k++) {
          const kx = (gridX + kps[i * 10 + k * 2]) * stride;
          const ky = (gridY + kps[i * 10 + k * 2 + 1]) * stride;
          landmarks.push([kx / scale, ky / scale]);
        }
      }

      result.push({
        bbox: [x1, y1, bw, bh],
        score,
        keypoints: landmarks,
      });
    }
  }

  return nms(result, 0.3);
}

function nms(dets: RawDetection[], iouThresh: number): RawDetection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: RawDetection[] = [];
  for (const d of sorted) {
    let drop = false;
    for (const k of keep) {
      if (iou(d.bbox, k.bbox) > iouThresh) {
        drop = true;
        break;
      }
    }
    if (!drop) keep.push(d);
  }
  return keep;
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ax1 = a[0];
  const ay1 = a[1];
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx1 = b[0];
  const by1 = b[1];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const areaA = (ax2 - ax1) * (ay2 - ay1);
  const areaB = (bx2 - bx1) * (by2 - by1);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

async function alignCrop(
  buffer: Buffer,
  detection: RawDetection,
  imgW: number,
  imgH: number,
): Promise<Buffer> {
  const [x, y, w, h] = detection.bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const half = (Math.max(w, h) * 1.25) / 2;
  const sx = Math.max(0, Math.floor(cx - half));
  const sy = Math.max(0, Math.floor(cy - half));
  const sw = Math.min(imgW - sx, Math.ceil(half * 2));
  const sh = Math.min(imgH - sy, Math.ceil(half * 2));

  return sharp(buffer)
    .extract({ left: sx, top: sy, width: sw, height: sh })
    .resize(FACE_SIZE, FACE_SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
}

function tensorFromRgb(pixels: Buffer): ort.Tensor {
  const plane = FACE_SIZE * FACE_SIZE;
  const values = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    values[i] = (pixels[i * 3] - 127.5) / 128;
    values[plane + i] = (pixels[i * 3 + 1] - 127.5) / 128;
    values[2 * plane + i] = (pixels[i * 3 + 2] - 127.5) / 128;
  }
  return new ort.Tensor("float32", values, [1, 3, FACE_SIZE, FACE_SIZE]);
}

function l2normalize(values: Float32Array | number[]): number[] {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / norm;
  return out;
}

export async function embedImage(buffer: Buffer): Promise<FaceEmbedResult> {
  const { width, height, faces } = await detectFaces(buffer);
  if (faces.length === 0) throw new FaceEmbedError("no_face");
  const top = faces.reduce((a, b) => (a.score >= b.score ? a : b));
  if (top.score < 0.7) throw new FaceEmbedError("low_quality");

  const faceBuf = await alignCrop(buffer, top, width, height);
  const session = await getFacenetSession();
  const tensor = tensorFromRgb(faceBuf);
  const inputName = session.inputNames[0];
  const outputs = await session.run({ [inputName]: tensor });
  const out = outputs[session.outputNames[0]];
  const values = out.data as Float32Array;
  if (values.length !== EMBEDDING_DIM) {
    throw new FaceEmbedError("internal", `unexpected_dim_${values.length}`);
  }
  const embedding = l2normalize(values);

  const faceQuality: "high" | "medium" =
    Math.min(top.bbox[2], top.bbox[3]) >= 96 && top.score >= 0.85 ? "high" : "medium";

  return {
    embedding,
    bbox: top.bbox,
    detScore: top.score,
    faceQuality,
  };
}

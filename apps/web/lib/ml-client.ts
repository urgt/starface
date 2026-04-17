const ML_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

export type EmbedResult = {
  embedding: number[];
  bbox: [number, number, number, number];
  det_score: number;
  face_quality: "high" | "medium";
  sex: "M" | "F" | null;
  age: number | null;
};

export type EmbedMultiResult = {
  embedding: number[];
  best_frame_index: number;
  accepted: number;
  rejected: Array<{ index: number; code: string; message?: string }>;
  bbox: [number, number, number, number];
  det_score: number;
  face_quality: "high" | "medium";
  sex: "M" | "F" | null;
  age: number | null;
};

export type MlErrorCode = "no_face" | "multiple_faces" | "low_quality" | "internal";

export class MlError extends Error {
  code: MlErrorCode;
  constructor(code: MlErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

async function postMl<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ML_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new MlError("internal", name === "TimeoutError" ? "ml_timeout" : `ml_fetch_failed:${name}`);
  }
  if (!res.ok) {
    let code: MlErrorCode = "internal";
    let message = `ML ${res.status}`;
    try {
      const b = (await res.json()) as { detail?: { code?: MlErrorCode; message?: string } };
      if (b.detail?.code) code = b.detail.code;
      if (b.detail?.message) message = b.detail.message;
    } catch {
      // ignore
    }
    throw new MlError(code, message);
  }
  return (await res.json()) as T;
}

export async function embedImage(imageBase64: string, allowMultiple = false): Promise<EmbedResult> {
  return postMl<EmbedResult>(
    "/ml/embed",
    { image_base64: imageBase64, allow_multiple: allowMultiple },
    15_000,
  );
}

export async function embedImageMulti(
  imagesBase64: string[],
  allowMultiple = false,
): Promise<EmbedMultiResult> {
  return postMl<EmbedMultiResult>(
    "/ml/embed-multi",
    { images_base64: imagesBase64, allow_multiple: allowMultiple },
    // Up to 5 frames × ~350ms each on CPU + overhead. Generous ceiling.
    25_000,
  );
}

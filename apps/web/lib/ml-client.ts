const ML_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8000";

export type EmbedResult = {
  embedding: number[];
  bbox: [number, number, number, number];
  det_score: number;
  face_quality: "high" | "medium";
};

export type MlErrorCode = "no_face" | "multiple_faces" | "low_quality" | "internal";

export class MlError extends Error {
  code: MlErrorCode;
  constructor(code: MlErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function embedImage(imageBase64: string, allowMultiple = false): Promise<EmbedResult> {
  let res: Response;
  try {
    res = await fetch(`${ML_URL}/ml/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: imageBase64, allow_multiple: allowMultiple }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new MlError("internal", name === "TimeoutError" ? "ml_timeout" : `ml_fetch_failed:${name}`);
  }
  if (!res.ok) {
    let code: MlErrorCode = "internal";
    let message = `ML ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: { code?: MlErrorCode; message?: string } };
      if (body.detail?.code) code = body.detail.code;
      if (body.detail?.message) message = body.detail.message;
    } catch {
      // ignore
    }
    throw new MlError(code, message);
  }
  return (await res.json()) as EmbedResult;
}

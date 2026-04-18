import {
  buildGeminiResponseSchema,
  descriptionsSchema,
  type GeneratedDescriptions,
  type Language,
} from "./schema";

const RETRY_DELAY_MS = 1500;
const MAX_OUTPUT_TOKENS = 800;
const TEMPERATURE = 0.4;

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export type GeminiResult = {
  descriptions: GeneratedDescriptions;
  inputTokens: number;
  outputTokens: number;
};

export type GeminiErrorCode =
  | "rate_limited"
  | "safety_blocked"
  | "upstream_error"
  | "parse_error";

export class GeminiError extends Error {
  code: GeminiErrorCode;
  retryAfterMs: number | null;
  detail: string | null;
  constructor(
    code: GeminiErrorCode,
    message: string,
    opts: { retryAfterMs?: number | null; detail?: string | null } = {},
  ) {
    super(message);
    this.code = code;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.detail = opts.detail ?? null;
  }
}

function parseRetryAfterMs(res: Response): number {
  const raw = res.headers.get("Retry-After");
  if (!raw) return RETRY_DELAY_MS;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs > 0) return Math.max(RETRY_DELAY_MS, secs * 1000);
  return RETRY_DELAY_MS;
}

async function callOnce(
  apiKey: string,
  model: string,
  prompt: string,
  languages: Language[],
): Promise<Response> {
  return await fetch(endpoint(model), {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: buildGeminiResponseSchema(languages),
      },
    }),
  });
}

export async function generateDescriptions(input: {
  apiKey: string;
  model: string;
  prompt: string;
  languages: Language[];
}): Promise<GeminiResult> {
  let response = await callOnce(input.apiKey, input.model, input.prompt, input.languages);

  if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
    await new Promise((r) => setTimeout(r, parseRetryAfterMs(response)));
    response = await callOnce(input.apiKey, input.model, input.prompt, input.languages);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new GeminiError("rate_limited", `HTTP ${response.status}`, {
        retryAfterMs: parseRetryAfterMs(response),
        detail: body.slice(0, 500),
      });
    }
    throw new GeminiError("upstream_error", `HTTP ${response.status}`, {
      detail: body.slice(0, 500),
    });
  }

  const raw = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    promptFeedback?: { blockReason?: string };
  };

  if (raw.promptFeedback?.blockReason) {
    throw new GeminiError("safety_blocked", "prompt blocked", {
      detail: raw.promptFeedback.blockReason,
    });
  }

  const candidate = raw.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new GeminiError("safety_blocked", "empty response", {
        detail: candidate.finishReason,
      });
    }
    throw new GeminiError("parse_error", "no text in response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError("parse_error", "response not json", { detail: text.slice(0, 200) });
  }

  const validated = descriptionsSchema.safeParse(parsed);
  if (!validated.success) {
    throw new GeminiError("parse_error", "schema validation failed", {
      detail: validated.error.message.slice(0, 500),
    });
  }

  return {
    descriptions: validated.data,
    inputTokens: raw.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

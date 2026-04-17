import { NextResponse } from "next/server";
import { z } from "zod";

import { getLlmConfig, maskApiKey, setLlmConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await getLlmConfig();
  return NextResponse.json({
    llm: {
      baseUrl: cfg.baseUrl,
      apiKeyMasked: maskApiKey(cfg.apiKey),
      model: cfg.model,
    },
  });
}

const patchSchema = z.object({
  baseUrl: z.string().url().max(500).optional(),
  apiKey: z.string().min(1).max(500).optional(),
  model: z.string().min(1).max(200).optional(),
});

export async function PATCH(req: Request) {
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad_request", detail: (e as Error).message }, { status: 400 });
  }
  await setLlmConfig(body);
  const cfg = await getLlmConfig();
  return NextResponse.json({
    ok: true,
    llm: {
      baseUrl: cfg.baseUrl,
      apiKeyMasked: maskApiKey(cfg.apiKey),
      model: cfg.model,
    },
  });
}

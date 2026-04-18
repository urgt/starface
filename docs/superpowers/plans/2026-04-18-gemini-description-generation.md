# Gemini Description Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate descriptions" flow to the admin UI that calls Google Gemini from the Cloudflare Worker, optionally grounds on Wikipedia, and pastes UZ/RU/EN output into the edit form for operator review.

**Architecture:** New Worker route `POST /api/admin/celebrities/[id]/generate-description` loads the celebrity, optionally fetches Wikipedia summaries via `Special:EntityData?props=sitelinks` + per-language summary endpoint, calls Gemini via native REST with structured JSON output, validates with Zod, logs an event, returns the languages to the client. New UI buttons in `EditMode` (one "Generate descriptions" + three per-field regenerate icons) drive the flow; no data is persisted until the operator clicks the existing Save.

**Tech Stack:** Next.js 15 App Router on Cloudflare Pages via @opennextjs/cloudflare, Drizzle ORM → D1, Zod, Gemini generativelanguage REST API, React 19.

**Project test policy (from CLAUDE.md):** no test suite. Correctness gates are `pnpm --filter @starface/web typecheck` and `pnpm --filter @starface/web lint` plus manual smoke via `next dev` / curl. Steps below use those gates; no pytest/jest.

**Commit format (from user's global CLAUDE.md):** Conventional Commits (`type: description`). No Co-Authored-By. No emojis.

**Design spec:** [docs/superpowers/specs/2026-04-18-gemini-description-generation-design.md](../specs/2026-04-18-gemini-description-generation-design.md). Section references below (§1–§13) point there.

---

## Task 0: Verify Gemini API specifics

Spec §12 lists four plan-time items to confirm. Lock them down before touching code, so every later task uses the real model ID and field names.

**Files:**
- None (research only).

- [ ] **Step 1: Fetch current Gemini model list**

Dispatch a haiku subagent (per user's global CLAUDE.md tool-routing rule for WebSearch/WebFetch — do not run WebFetch from the main model) with this prompt:

```
Fetch https://ai.google.dev/gemini-api/docs/models and https://ai.google.dev/gemini-api/docs/pricing.

Report ONLY:
1. Exact model-ID string for the current Flash-Lite variant usable with
   generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
   (e.g. "gemini-2.5-flash-lite" or "gemini-3-flash-lite" etc. — whichever
   is current as of 2026).
2. Whether that model supports responseSchema in generationConfig.
3. The exact field name(s) for structured output: responseSchema vs
   response_schema vs responseJsonSchema.
4. The exact safetySettings category constants (strings like
   "HARM_CATEGORY_HARASSMENT") and threshold constants.
5. Paid-tier RPM/TPM for Flash-Lite on Tier 1.

Under 200 words. Flag anything uncertain.
```

- [ ] **Step 2: Record the findings**

Create (or append to) a local scratch note in your session memory — we will cite these values in Tasks 1, 5. The canonical values go into `wrangler.toml` (Task 1) and `lib/llm/gemini.ts` (Task 5).

If the research confirms a 2026 model ID is available, that becomes `GEMINI_MODEL`. If research is uncertain, keep `gemini-2.5-flash-lite` as spec §5.1 mandates (conservative known-good).

No commit in this task.

---

## Task 1: Add GEMINI_MODEL var and regenerate types

**Files:**
- Modify: `apps/web/wrangler.toml`
- Modify (regenerated): `apps/web/cloudflare-env.d.ts`

- [ ] **Step 1: Add GEMINI_MODEL to [vars]**

Open `apps/web/wrangler.toml`. Under `[vars]`, after `NEXT_PUBLIC_APP_URL`, add:

```toml
GEMINI_MODEL = "gemini-2.5-flash-lite"
```

(Replace with the confirmed 2026 ID from Task 0 if research returned one.)

- [ ] **Step 2: Regenerate cloudflare-env.d.ts**

Run:

```bash
pnpm --filter @starface/web cf-typegen
```

Expected: the `Env` interface in `apps/web/cloudflare-env.d.ts` gains a `GEMINI_MODEL: "gemini-2.5-flash-lite";` line. `GEMINI_API_KEY` will NOT appear here (secrets are not emitted) — we reference `env.GEMINI_API_KEY` via the types that wrangler auto-augments at runtime; to satisfy TypeScript in our code we treat it as `string | undefined` and assert at runtime (see Task 6 route).

- [ ] **Step 3: Typecheck**

Run:

```bash
pnpm --filter @starface/web typecheck
```

Expected: PASS (no new usages of the env yet; we just added a var to config).

- [ ] **Step 4: Commit**

```bash
git add apps/web/wrangler.toml apps/web/cloudflare-env.d.ts
git commit -m "feat: add GEMINI_MODEL binding for description generation"
```

---

## Task 2: Language type + Zod schema for generated output

**Files:**
- Create: `apps/web/lib/llm/schema.ts`

- [ ] **Step 1: Create schema.ts**

Create `apps/web/lib/llm/schema.ts` with:

```ts
import { z } from "zod";

export type Language = "uz" | "ru" | "en";

export const LANGUAGES: Language[] = ["uz", "ru", "en"];

export const descriptionsSchema = z.object({
  uz: z.string().min(1).optional(),
  ru: z.string().min(1).optional(),
  en: z.string().min(1).optional(),
});

export type GeneratedDescriptions = z.infer<typeof descriptionsSchema>;

export function buildGeminiResponseSchema(languages: Language[]) {
  const properties: Record<string, { type: "STRING" }> = {};
  for (const lang of languages) properties[lang] = { type: "STRING" };
  return {
    type: "OBJECT" as const,
    properties,
    required: languages,
  };
}
```

Rationale for the min(1) / optional combo: the Zod type stays lenient because we prune the Gemini `responseSchema.required` list per-request (spec §5.3), so a single-language call legitimately returns a one-field object. The route (Task 6) enforces that every **requested** language came back non-empty.

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @starface/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/llm/schema.ts
git commit -m "feat: add zod schema and language type for generated descriptions"
```

---

## Task 3: Prompt builder

**Files:**
- Create: `apps/web/lib/llm/prompts.ts`

- [ ] **Step 1: Create prompts.ts**

Create `apps/web/lib/llm/prompts.ts` with:

```ts
import type { Language } from "./schema";

export type CelebrityInput = {
  name: string;
  nameRu: string | null;
  wikidataId: string | null;
  category: string | null;
  gender: string | null;
  age: number | null;
};

export type WikipediaContext = {
  en: string | null;
  ru: string | null;
  uz: string | null;
};

const EXCERPT_MAX_CHARS = 800;
const EXISTING_MAX_CHARS = 500;

function sanitize(text: string, tagName: string, maxChars: number): string {
  const stripped = text.replaceAll(`</${tagName}>`, "");
  return stripped.length > maxChars ? stripped.slice(0, maxChars) : stripped;
}

export function buildDescriptionPrompt(
  celeb: CelebrityInput,
  wiki: WikipediaContext | null,
  languages: Language[],
  existing?: Partial<Record<Language, string>>,
): string {
  const parts: string[] = [
    "You are writing a short biographical description of a public figure for a celebrity-match kiosk. Produce 2-3 sentences per language. Neutral tone. Include the most notable fact (profession, main achievement, era). Do not invent facts. If uncertain, omit the doubtful fact.",
    "",
    `Celebrity name: ${celeb.name}`,
    `Russian name: ${celeb.nameRu ?? "-"}`,
    `Wikidata ID: ${celeb.wikidataId ?? "-"}`,
    `Category: ${celeb.category ?? "-"}`,
    `Gender: ${celeb.gender ?? "-"}`,
    `Age (approx): ${celeb.age ?? "-"}`,
    "",
  ];

  if (wiki) {
    if (wiki.en) parts.push(`<excerpt lang="en">${sanitize(wiki.en, "excerpt", EXCERPT_MAX_CHARS)}</excerpt>`);
    if (wiki.ru) parts.push(`<excerpt lang="ru">${sanitize(wiki.ru, "excerpt", EXCERPT_MAX_CHARS)}</excerpt>`);
    if (wiki.uz) parts.push(`<excerpt lang="uz">${sanitize(wiki.uz, "excerpt", EXCERPT_MAX_CHARS)}</excerpt>`);
    parts.push("");
  }

  if (existing) {
    for (const lang of languages) {
      const text = existing[lang];
      if (text && text.length > 0) {
        parts.push(
          `Improve the following existing text rather than replace it with unrelated content. Do not invent facts. Existing ${lang} text: <existing>${sanitize(text, "existing", EXISTING_MAX_CHARS)}</existing>`,
        );
      }
    }
    parts.push("");
  }

  parts.push(
    `Return a JSON object with fields ${languages.join(", ")}. Each value is 2-3 sentences in that language. For the Uzbek field, use standard Latin-script Uzbek (not Cyrillic).`,
  );

  return parts.join("\n");
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @starface/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/llm/prompts.ts
git commit -m "feat: add description prompt builder with xml-delimited excerpts"
```

---

## Task 4: Wikipedia client

**Files:**
- Create: `apps/web/lib/wikipedia.ts`

- [ ] **Step 1: Create wikipedia.ts**

Create `apps/web/lib/wikipedia.ts` with:

```ts
import type { Language } from "./llm/schema";

const FETCH_TIMEOUT_MS = 4000;

const wikidataEntityUrl = (id: string) =>
  `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(id)}.json?props=sitelinks`;

const wikipediaSummaryUrl = (lang: string, title: string) =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

type SitelinkMap = Record<string, { title?: string } | undefined>;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "starface-admin/1.0 (dataset enrichment)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getSitelinks(wikidataId: string): Promise<SitelinkMap> {
  try {
    const res = await fetchWithTimeout(wikidataEntityUrl(wikidataId));
    if (!res.ok) return {};
    const data = (await res.json()) as {
      entities?: Record<string, { sitelinks?: SitelinkMap }>;
    };
    return data.entities?.[wikidataId]?.sitelinks ?? {};
  } catch {
    return {};
  }
}

async function fetchSummary(lang: string, title: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(wikipediaSummaryUrl(lang, title));
    if (!res.ok) return null;
    const data = (await res.json()) as { extract?: string };
    return data.extract ?? null;
  } catch {
    return null;
  }
}

export type WikipediaSummaries = {
  uz: string | null;
  ru: string | null;
  en: string | null;
};

export async function fetchSummaries(
  wikidataId: string,
  langs: Language[],
): Promise<WikipediaSummaries> {
  const out: WikipediaSummaries = { uz: null, ru: null, en: null };
  const sitelinks = await getSitelinks(wikidataId);

  await Promise.all(
    langs.map(async (lang) => {
      const title = sitelinks[`${lang}wiki`]?.title;
      if (!title) return;
      out[lang] = await fetchSummary(lang, title);
    }),
  );

  return out;
}
```

Why we set a `User-Agent`: Wikipedia's REST API enforces a UA policy for automated callers and rate-limits or blocks requests lacking one. Cloudflare Workers' default `fetch` UA can trigger soft blocks.

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @starface/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/wikipedia.ts
git commit -m "feat: add wikipedia summary client with sitelinks lookup"
```

---

## Task 5: Gemini client

**Files:**
- Create: `apps/web/lib/llm/gemini.ts`

- [ ] **Step 1: Create gemini.ts**

Create `apps/web/lib/llm/gemini.ts` with:

```ts
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
        responseSchema: buildGeminiResponseSchema(languages),
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
    const delay = parseRetryAfterMs(response);
    await new Promise((r) => setTimeout(r, delay));
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
```

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @starface/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Lint**

Run:

```bash
pnpm --filter @starface/web lint
```

Expected: PASS (no new files trigger warnings).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/llm/gemini.ts
git commit -m "feat: add gemini client with retry and structured output parsing"
```

---

## Task 6: Route handler `POST /api/admin/celebrities/[id]/generate-description`

**Files:**
- Create: `apps/web/app/api/admin/celebrities/[id]/generate-description/route.ts`

- [ ] **Step 1: Create the route file**

Create `apps/web/app/api/admin/celebrities/[id]/generate-description/route.ts` with:

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { GeminiError, generateDescriptions } from "@/lib/llm/gemini";
import {
  buildDescriptionPrompt,
  type CelebrityInput,
  type WikipediaContext,
} from "@/lib/llm/prompts";
import { LANGUAGES, type Language } from "@/lib/llm/schema";
import { fetchSummaries } from "@/lib/wikipedia";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({
  languages: z.array(z.enum(["uz", "ru", "en"])).min(1).max(3).optional(),
  skipWikipedia: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await req.json().catch(() => ({}));
    body = bodySchema.parse(json);
  } catch (e) {
    return NextResponse.json(
      { error: "bad_request", detail: (e as Error).message },
      { status: 400 },
    );
  }

  const languages: Language[] = body.languages ?? LANGUAGES;

  const [celeb] = await db
    .select({
      id: schema.celebrities.id,
      name: schema.celebrities.name,
      nameRu: schema.celebrities.nameRu,
      wikidataId: schema.celebrities.wikidataId,
      category: schema.celebrities.category,
      gender: schema.celebrities.gender,
      age: schema.celebrities.age,
      descriptionUz: schema.celebrities.descriptionUz,
      descriptionRu: schema.celebrities.descriptionRu,
      descriptionEn: schema.celebrities.descriptionEn,
    })
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);

  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { env } = getCloudflareContext();
  const apiKey = (env as unknown as { GEMINI_API_KEY?: string }).GEMINI_API_KEY;
  const model = env.GEMINI_MODEL;
  if (!apiKey) {
    return NextResponse.json(
      { error: "internal", detail: "GEMINI_API_KEY missing" },
      { status: 500 },
    );
  }

  const celebInput: CelebrityInput = {
    name: celeb.name,
    nameRu: celeb.nameRu,
    wikidataId: celeb.wikidataId,
    category: celeb.category,
    gender: celeb.gender,
    age: celeb.age,
  };

  let wiki: WikipediaContext | null = null;
  let source: "wikipedia" | "none" = "none";
  if (celeb.wikidataId && !body.skipWikipedia) {
    const summaries = await fetchSummaries(celeb.wikidataId, LANGUAGES);
    if (summaries.uz || summaries.ru || summaries.en) {
      wiki = summaries;
      source = "wikipedia";
    }
  }

  const existing: Partial<Record<Language, string>> = {};
  if (celeb.descriptionUz) existing.uz = celeb.descriptionUz;
  if (celeb.descriptionRu) existing.ru = celeb.descriptionRu;
  if (celeb.descriptionEn) existing.en = celeb.descriptionEn;

  const prompt = buildDescriptionPrompt(celebInput, wiki, languages, existing);

  const start = Date.now();
  let result: Awaited<ReturnType<typeof generateDescriptions>> | null = null;
  let errorCode: string | null = null;

  try {
    result = await generateDescriptions({ apiKey, model, prompt, languages });
  } catch (e) {
    errorCode = e instanceof GeminiError ? e.code : "internal";
  }

  const latencyMs = Date.now() - start;
  const success = result !== null && errorCode === null;

  await db.insert(schema.events).values({
    brandId: null,
    resultId: null,
    eventType: "admin.description_generated",
    metadata: {
      celebrityId: celeb.id,
      model,
      languages,
      latencyMs,
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      source,
      success,
      ...(errorCode ? { errorCode } : {}),
    },
  });

  if (!success || !result) {
    if (errorCode === "rate_limited") {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    if (errorCode === "safety_blocked") {
      return NextResponse.json({ error: "safety_blocked" }, { status: 422 });
    }
    if (errorCode === "parse_error") {
      return NextResponse.json(
        { error: "internal", detail: "parse_error" },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }

  const missing = languages.filter((l) => !result.descriptions[l]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "internal", detail: `missing_languages:${missing.join(",")}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...result.descriptions,
    source,
    model,
    latencyMs,
  });
}
```

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @starface/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Lint**

Run:

```bash
pnpm --filter @starface/web lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/admin/celebrities/[id]/generate-description/route.ts
git commit -m "feat: add route for gemini-powered description generation"
```

---

## Task 7: UI — Generate buttons in EditMode

**Files:**
- Modify: `apps/web/app/admin/celebrities/CelebritiesList.tsx:343-503` (EditMode function + Descriptions block)

This task keeps EditMode in the same file. The spec's file-split suggestion is tracked in phase A (separate future work) and deliberately not bundled here.

- [ ] **Step 1: Add new state and the generate helper inside EditMode**

In `apps/web/app/admin/celebrities/CelebritiesList.tsx`, inside `EditMode` (starts at line 343), immediately after the existing `useState` block that ends with `const [deleting, setDeleting] = useState(false);`, add:

```ts
type GenLang = "uz" | "ru" | "en";
type GenTarget = "all" | GenLang;

const [genTarget, setGenTarget] = useState<GenTarget | null>(null);
const [genError, setGenError] = useState<string | null>(null);
const [genSource, setGenSource] = useState<"wikipedia" | "none" | null>(null);

async function generate(target: GenTarget) {
  const languages: GenLang[] | undefined =
    target === "all" ? undefined : [target];
  setGenTarget(target);
  setGenError(null);
  try {
    const res = await fetch(
      `/api/admin/celebrities/${detail.id}/generate-description`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(languages ? { languages } : {}),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      uz?: string;
      ru?: string;
      en?: string;
      source?: "wikipedia" | "none";
      error?: string;
      detail?: string;
    };
    if (!res.ok) {
      setGenError(
        data.error === "rate_limited"
          ? "Rate limited, try again in a moment."
          : data.error === "safety_blocked"
            ? "Gemini blocked the response (safety filter)."
            : data.error === "upstream_error"
              ? "Gemini API error. Try again."
              : data.error ?? `HTTP ${res.status}`,
      );
      return;
    }
    if (data.uz) setDescUz(data.uz);
    if (data.ru) setDescRu(data.ru);
    if (data.en) setDescEn(data.en);
    setGenSource(data.source ?? null);
  } catch (e) {
    setGenError((e as Error).message);
  } finally {
    setGenTarget(null);
  }
}
```

- [ ] **Step 2: Replace the Descriptions block**

Locate the block starting at line 483:

```tsx
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Descriptions
        </h3>
        <DescField label="Uzbek" value={descUz} onChange={setDescUz} />
        <DescField label="Russian" value={descRu} onChange={setDescRu} />
        <DescField label="English" value={descEn} onChange={setDescEn} />
      </div>
```

Replace it with:

```tsx
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Descriptions
          </h3>
          <div className="flex items-center gap-2">
            {genSource && !genError && (
              <span className="text-xs text-neutral-500">
                {genSource === "wikipedia"
                  ? "Generated from Wikipedia"
                  : "Generated from name only"}
              </span>
            )}
            <button
              type="button"
              onClick={() => void generate("all")}
              disabled={genTarget !== null}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {genTarget === "all" ? "Generating…" : "Generate descriptions"}
            </button>
          </div>
        </div>
        {genError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {genError}
          </p>
        )}
        <DescField
          label="Uzbek"
          value={descUz}
          onChange={setDescUz}
          onRegenerate={() => void generate("uz")}
          regenerating={genTarget === "uz" || genTarget === "all"}
        />
        <DescField
          label="Russian"
          value={descRu}
          onChange={setDescRu}
          onRegenerate={() => void generate("ru")}
          regenerating={genTarget === "ru" || genTarget === "all"}
        />
        <DescField
          label="English"
          value={descEn}
          onChange={setDescEn}
          onRegenerate={() => void generate("en")}
          regenerating={genTarget === "en" || genTarget === "all"}
        />
      </div>
```

- [ ] **Step 3: Extend `DescField` with regenerate button**

Locate `DescField` at line 505. Replace the whole function with:

```tsx
function DescField({
  label,
  value,
  onChange,
  onRegenerate,
  regenerating,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center gap-2 font-medium">
        {label}
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            aria-label={`Regenerate ${label} description`}
            title={`Regenerate ${label}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[10px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            {regenerating ? "…" : "↻"}
          </button>
        )}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={regenerating}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
      />
    </label>
  );
}
```

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @starface/web typecheck
```

Expected: PASS.

- [ ] **Step 5: Lint**

Run:

```bash
pnpm --filter @starface/web lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/admin/celebrities/CelebritiesList.tsx
git commit -m "feat: add generate and regenerate buttons to celebrity edit form"
```

---

## Task 8: Local smoke test against prod bindings

This exercises the full path with the real Gemini endpoint. Requires `GEMINI_API_KEY` in `apps/web/.dev.vars` and `next dev` configured with remote bindings per the earlier session guidance.

**Files:**
- Modify: `apps/web/.dev.vars` (local only, not in git)

- [ ] **Step 1: Add the API key locally**

Ensure `apps/web/.dev.vars` contains (create the file if missing; it is gitignored):

```
ADMIN_USER=admin
ADMIN_PASSWORD=<your admin password from prod>
CRON_SHARED_SECRET=<prod value>
BRAND_ANALYTICS_TOKEN_SALT=<prod value>
GEMINI_API_KEY=<your Google AI Studio key>
```

Obtain the key at https://aistudio.google.com/app/apikey. Free tier works for smoke; switch to a paid-billing project later for production.

- [ ] **Step 2: Start dev server**

Run in a separate terminal:

```bash
pnpm --filter @starface/web dev
```

Expected: server on `http://0.0.0.0:3000` (or next free port — pass `-- --port 3001` if 3000 is taken).

- [ ] **Step 3: Smoke — existing celeb with wikidataId**

In the browser at `http://127.0.0.1:3000/admin/celebrities`, open a celebrity that has a `wikidataId` set, click Edit, click "Generate descriptions". Expected:

- Button text becomes `Generating…` for 2–4 seconds.
- Three textareas fill with UZ/RU/EN text.
- A label `Generated from Wikipedia` appears next to the button.
- No error banner.

Now click Save and re-open the celeb. Descriptions persisted.

- [ ] **Step 4: Smoke — no wikidataId**

Open a celeb without `wikidataId`. Click Generate. Expected:

- Text fills (from model's internal knowledge).
- Label says `Generated from name only`.
- Works without error.

- [ ] **Step 5: Smoke — per-language regenerate**

On any edited celeb, modify all three textareas to known garbage (`"X"`). Click only the ↻ icon next to "Russian". Expected:

- Only Russian textarea changes. UZ/EN remain `"X"`.
- Neither Save nor Cancel was required to trigger regeneration.

- [ ] **Step 6: Smoke — error on missing key**

Temporarily rename `GEMINI_API_KEY` in `.dev.vars` to `GEMINI_API_KEY_X`, restart dev server, click Generate. Expected:

- Red banner says something like `GEMINI_API_KEY missing` (500 error from the route).
- Textareas unchanged.

Restore the key name and restart the server.

- [ ] **Step 7: Verify event logging**

While dev is still running, in a separate terminal, query D1 via wrangler to confirm events are written:

```bash
cd apps/web
npx wrangler d1 execute starface --remote --command "SELECT event_type, metadata, created_at FROM events WHERE event_type = 'admin.description_generated' ORDER BY id DESC LIMIT 5;"
```

Expected: at least the rows from Steps 3–6 are present with populated `metadata.model`, `metadata.latencyMs`, `metadata.success`.

- [ ] **Step 8: No commit needed (smoke only)**

Nothing changed in tracked files. Move to Task 9.

---

## Task 9: Prod rollout

**Files:**
- Modify: `CLAUDE.md` (config reference section)
- Write secret: `GEMINI_API_KEY` in the prod Worker environment (not committed)

**STOP before executing Step 3 of this task.** Per user's global CLAUDE.md: "Не пушь без моего подтверждения". Ask the user before running `wrangler secret put` or `deploy`.

- [ ] **Step 1: Update CLAUDE.md config reference**

Open `CLAUDE.md` at the repo root. Find the section `## Config reference` → subsection `Prod (apps/web/wrangler.toml [vars] + wrangler secret put)`.

In the list of `[vars]` add `GEMINI_MODEL`. In the list of secrets add `GEMINI_API_KEY`. Current paragraph reads:

```
1. **Prod (`apps/web/wrangler.toml` `[vars]` + `wrangler secret put`)** — `MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`, `USER_PHOTO_TTL_HOURS`, `NEXT_PUBLIC_APP_URL` as vars; `ADMIN_USER`, `ADMIN_PASSWORD`, `CRON_SHARED_SECRET`, `BRAND_ANALYTICS_TOKEN_SALT` as secrets. ...
```

Replace with:

```
1. **Prod (`apps/web/wrangler.toml` `[vars]` + `wrangler secret put`)** — `MATCH_MIN_COSINE`, `DISPLAY_MIN_PCT`, `DISPLAY_MAX_PCT`, `USER_PHOTO_TTL_HOURS`, `NEXT_PUBLIC_APP_URL`, `GEMINI_MODEL` as vars; `ADMIN_USER`, `ADMIN_PASSWORD`, `CRON_SHARED_SECRET`, `BRAND_ANALYTICS_TOKEN_SALT`, `GEMINI_API_KEY` as secrets. ...
```

(Keep the remaining text of that paragraph unchanged.)

- [ ] **Step 2: Commit the doc update**

```bash
git add CLAUDE.md
git commit -m "docs: note GEMINI_MODEL var and GEMINI_API_KEY secret"
```

- [ ] **Step 3: Ask the user to proceed with deploy**

Stop here. Output the line:

> "Ready to deploy. The next three steps write the prod secret and deploy. Confirm before I run them."

Wait for explicit user confirmation. Do NOT run Steps 4–6 automatically.

- [ ] **Step 4: Set the prod secret (after user confirms)**

```bash
cd apps/web
npx wrangler secret put GEMINI_API_KEY
```

Paste the prod Google AI Studio key at the interactive prompt.

Expected: `Success! Uploaded secret GEMINI_API_KEY`.

- [ ] **Step 5: Deploy**

```bash
pnpm --filter @starface/web deploy
```

Expected: `opennextjs-cloudflare build` finishes, then `deploy` reports a deployment URL.

- [ ] **Step 6: Prod smoke**

Open `https://starface.pages.dev/admin/celebrities` (or the actual prod URL from `NEXT_PUBLIC_APP_URL`). Repeat §9 steps 1, 3, 5 from the design spec against prod:

1. Generate for a celeb with `wikidataId` — three languages returned, "Generated from Wikipedia".
2. Regenerate a single field — only that field updates.
3. Generate for a celeb without `wikidataId` — works, "Generated from name only".

Verify the events are landing in prod D1:

```bash
cd apps/web
npx wrangler d1 execute starface --remote --command "SELECT event_type, metadata, created_at FROM events WHERE event_type = 'admin.description_generated' ORDER BY id DESC LIMIT 3;"
```

- [ ] **Step 7: No commit — tasks complete**

Implementation complete.

---

## Coverage check

Tracking each spec section to at least one task:

- §1 Motivation — context, not actionable.
- §2 Goals / non-goals — non-goals deliberately absent from every task; in-scope items all mapped below.
- §3.1 Flow — Task 6 (route) + Task 7 (UI) + Task 4 (wiki) + Task 5 (gemini).
- §3.2 Bindings / secrets — Task 1 (var), Task 8 (local `.dev.vars`), Task 9 (prod secret).
- §3.3 File layout — all listed files covered (Tasks 2–7).
- §4 API contract — Task 6.
- §5.1–§5.3 Model / endpoint / request shape — Task 5.
- §5.4 Prompt — Task 3.
- §5.5 Retry — Task 5.
- §5.6 Safety — Task 5 uses defaults per spec; no code path.
- §6.1 Wikipedia resolution — Task 4.
- §6.2 Regenerate vs first-time — Task 3 (prompt) + Task 6 (passes existing).
- §7 UX — Task 7.
- §8 Observability — Task 6.
- §9 Testing (manual checklist) — Task 8 local + Task 9 prod smoke.
- §10 Security — Task 5 (header auth), Task 6 (no text in logs).
- §11 Cost / capacity — no code; informational.
- §12 Open items — Task 0 resolves item 1; items 2–4 are folded into Tasks 1 / 5 defaults.
- §13 Sequencing — task order matches.

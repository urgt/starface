# Gemini-powered Celebrity Description Generation — Design

**Status:** Draft
**Date:** 2026-04-18
**Scope:** Sub-project B of the dataset-management initiative (see session brainstorm). Covers LLM-backed generation and regeneration of multilingual (UZ/RU/EN) celebrity descriptions from the admin UI.
**Adjacent work (out of scope here):** Auto photo search (C), bulk Wikipedia import (D), CRUD foundation polish (A).

## 1. Motivation

Filling in `descriptionUz / descriptionRu / descriptionEn` for each celebrity is the single slowest manual step when extending the dataset. The existing admin UI (`apps/web/app/admin/celebrities/CelebritiesList.tsx`) has an edit form with three textareas but no assisted generation. Operators either translate Wikipedia intros by hand or leave fields empty, which degrades the mobile result page (`/r/[resultId]`).

This sub-project adds "Generate" / "Regenerate" actions that call Google Gemini from the Cloudflare Worker and paste generated text into the edit form for operator review. Nothing is persisted until the operator clicks Save.

## 2. Goals / non-goals

### In scope

- One-shot generation of all three languages in a single Gemini call, parsed via structured JSON output.
- Optional Wikipedia grounding when `wikidataId` is known, to reduce hallucination.
- Per-field regenerate (single language) for targeted fixes.
- Sensible error handling (429 backoff, safety blocks, network).
- Observability: usage recorded in the `events` table for later cost/latency review.

### Out of scope

- Batch generation across many celebrities. (Covered by sub-project D.)
- Streaming/SSE output. Operator sees a 2–3 s spinner per request.
- Configurable tone / length selectors. Hard-coded in the prompt.
- A UI for editing the prompt template itself.
- Auto-saving generated output. Everything goes through `PATCH` on operator click.
- Generating non-description fields (category, gender, age). Only descriptions.

## 3. Architecture

### 3.1 Flow

```
Operator (EditMode in admin/celebrities modal)
  │
  │ click "Generate descriptions" (all) or "↻" next to a field
  ▼
POST /api/admin/celebrities/:id/generate-description
  body: { languages?: ("uz"|"ru"|"en")[] }   // all three if omitted
  │
  │ Cloudflare Worker
  ▼
1. Load celebrity row from D1 (name, nameRu, wikidataId, category, gender, age).
2. If wikidataId is set: fetch Wikipedia summaries in parallel for requested
   languages (falling back enwiki → ruwiki → uzwiki if a language is missing).
3. Build prompt (lib/llm/prompts.ts) + structured-output schema matching the
   requested languages.
4. Call Gemini via native endpoint. Retry once on 429 / 5xx with backoff.
5. Parse JSON response, validate with Zod, return to client.
6. Log an `events` row: { eventType: "admin.description_generated",
   metadata: { celebrityId, model, languages, latencyMs, inputTokens,
   outputTokens, source: "wikipedia"|"none" } }.
  │
  ▼
Client pastes returned text into the three textareas in EditMode.
Operator reviews / tweaks / clicks existing Save button.
  │
  ▼
PATCH /api/admin/celebrities/:id   (unchanged route) — persists descriptions.
```

Nothing in the generation route writes to `celebrities` / `celebrity_photos` / `FACES`. It is a pure read-and-call endpoint.

### 3.2 Bindings / secrets

- `GEMINI_API_KEY` — Cloudflare secret (`wrangler secret put GEMINI_API_KEY`).
- `GEMINI_MODEL` — Cloudflare `[vars]` with default (see §7.3). Swappable without redeploy-if-var-only change in principle, but we still redeploy; the variable merely documents the choice in `wrangler.toml`.

No new bindings. No new D1 tables. No new R2 paths.

### 3.3 File layout

New:

- `apps/web/lib/llm/gemini.ts` — provider client. Single exported function
  `generateDescriptions(input, env)` returning `{ uz?, ru?, en? }`. Handles
  endpoint, auth (?key=...), schema injection, retry, Zod parse.
- `apps/web/lib/llm/prompts.ts` — `buildDescriptionPrompt(celeb, wikiContext, languages)`.
- `apps/web/lib/llm/schema.ts` — Zod schema for the structured response. Exported
  for both the route and the test(s).
- `apps/web/lib/wikipedia.ts` — `fetchSummaries(wikidataId, langs)`, thin wrapper
  around `https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}` with a
  small Wikidata → title lookup via `https://www.wikidata.org/wiki/Special:EntityData/{id}.json`.
- `apps/web/app/api/admin/celebrities/[id]/generate-description/route.ts` —
  Worker endpoint implementing §3.1.

Modified (minimally):

- `apps/web/app/admin/celebrities/CelebritiesList.tsx` — add a "Generate
  descriptions" button in the description block of `EditMode`, plus a small "↻"
  per-language button next to each textarea label. No structural split of the
  file in this sub-project (gap #5 is tracked separately in phase A).
- `apps/web/wrangler.toml` — add `GEMINI_MODEL = "gemini-3-flash-lite"` under
  `[vars]`. Document `GEMINI_API_KEY` secret.
- `apps/web/cloudflare-env.d.ts` — regenerated via `cf-typegen`.
- `CLAUDE.md` — short note in config reference about the new secret + var.

No changes to `apps/web/app/api/admin/celebrities/[id]/route.ts` (the PATCH
handler already accepts the three description fields).

## 4. API contract

### 4.1 Request

`POST /api/admin/celebrities/:id/generate-description`

Behind Basic Auth middleware (same as other `/api/admin/*` routes).

```ts
// body
{
  // Which languages to generate. Omitting the field means all three.
  languages?: Array<"uz" | "ru" | "en">;

  // When true, skip Wikipedia grounding even if wikidataId exists.
  // Default false. Used by callers who know Wikipedia is unreliable for
  // a given celebrity.
  skipWikipedia?: boolean;
}
```

### 4.2 Response (200)

```ts
{
  uz?: string;   // present iff requested
  ru?: string;
  en?: string;
  source: "wikipedia" | "none";   // did we ground on Wikipedia?
  model: string;                  // echoed GEMINI_MODEL
  latencyMs: number;
}
```

### 4.3 Error responses

- `400 bad_request` — body fails Zod validation.
- `404 not_found` — celebrity id does not exist.
- `429 rate_limited` — Gemini returned 429 and retry failed. Includes
  `retryAfterMs` if the upstream supplied one.
- `422 safety_blocked` — Gemini blocked output on a safety category. Includes
  the blocked category so the UI can tell the operator.
- `502 upstream_error` — any other non-2xx from Gemini after retry.
- `500 internal` — parse / schema validation failures (generation came back
  but was not a valid JSON object matching the schema).

The JSON body of every error is `{ error: string, detail?: string, ... }`.

## 5. LLM details

### 5.1 Model

`GEMINI_MODEL = "gemini-3-flash-lite"` by default. Research to confirm the exact canonical model ID (`gemini-3-flash-lite` vs `gemini-3-1-flash-lite` vs `gemini-2.5-flash-lite`) is a **plan-time task** — see §12 open items. Whichever is current, we target the Flash-Lite tier for cost.

Pricing benchmark (approximate): ~500 input + ~300 output tokens per call → well under a cent. 1000 celebrities ≈ under $1 at Flash-Lite rates. Cost is a non-issue for the foreseeable dataset size.

### 5.2 Endpoint

Native REST, not the OpenAI-compatibility shim:

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
```

Auth: API key in query string. Worker reads `env.GEMINI_API_KEY`.

### 5.3 Request shape

```jsonc
{
  "contents": [{ "role": "user", "parts": [{ "text": "<prompt>" }] }],
  "generationConfig": {
    "temperature": 0.4,
    "maxOutputTokens": 800,
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "OBJECT",
      "properties": {
        "uz": { "type": "STRING" },
        "ru": { "type": "STRING" },
        "en": { "type": "STRING" }
      },
      "required": ["uz", "ru", "en"]   // pruned to requested langs
    }
  },
  "safetySettings": [
    // default thresholds; revisit if biographies start getting blocked
  ]
}
```

We prune the `required` list and `properties` to only the requested languages — structured output will then return only those fields and we save ~30% output tokens when regenerating a single language.

### 5.4 Prompt (canonical form)

```
You are writing a short biographical description of a public figure for a
celebrity-match kiosk. Produce 2–3 sentences per language. Neutral tone.
Include the most notable fact (profession, main achievement, era). Do not
invent facts. If uncertain, omit the doubtful fact.

Celebrity name: {name}
Russian name: {nameRu ?? "—"}
Wikidata ID: {wikidataId ?? "—"}
Category: {category ?? "—"}
Gender: {gender ?? "—"}
Age (approx): {age ?? "—"}

{if wikipedia}
Reference excerpt (English Wikipedia):
"""
{enWiki}
"""
Reference excerpt (Russian Wikipedia):
"""
{ruWiki}
"""
Reference excerpt (Uzbek Wikipedia):
"""
{uzWiki}
"""
{endif}

Return a JSON object with fields uz, ru, en. Each value is 2–3 sentences in
that language. For the Uzbek field, use standard Latin-script Uzbek (not
Cyrillic).
```

Prompt lives in `apps/web/lib/llm/prompts.ts` as a pure function. Any tweak is
a one-line change.

### 5.5 Retry policy

- One retry on HTTP 429 or 5xx, with a 1500 ms delay (doubled if `Retry-After` header suggests more).
- No retry on 4xx other than 429.
- If the second attempt also fails, surface the error to the operator via §4.3 — do not silently swallow.

### 5.6 Safety

Use Gemini's defaults. If, in practice, biographies start getting blocked (unlikely for public figures), we lower thresholds for `HARM_CATEGORY_HARASSMENT` and `HARM_CATEGORY_DANGEROUS` only. No code path for tuning exists in the MVP — it will be a manual edit of `lib/llm/gemini.ts` when/if it happens.

## 6. Wikipedia grounding

### 6.1 Resolution

Given `wikidataId` like `Q12345`:

1. Fetch `https://www.wikidata.org/wiki/Special:EntityData/Q12345.json`.
2. From the `sitelinks` map, read `enwiki.title`, `ruwiki.title`, `uzwiki.title`.
3. For each available sitelink **whose language is in `languages`**, fetch
   `https://{lang}.wikipedia.org/api/rest_v1/page/summary/{encodedTitle}`.
4. Extract `.extract` (the intro paragraph). Truncate to 800 characters.

Wikidata + Wikipedia calls run in parallel (single `Promise.all`). Timeouts: 4 seconds each. A failure on any language is logged and skipped — the prompt simply omits that reference block.

If no `wikidataId`, we skip the whole step. Prompt contains no Wikipedia section. `source: "none"` is returned.

### 6.2 Regenerate vs first-time

If the celebrity already has a description in language L and the operator clicks the per-field "↻" for L, we:

- Still fetch Wikipedia (same as first-time).
- Append to the prompt: `Improve the following existing text rather than replace it with unrelated content. Do not invent facts. Existing {L} text: "..."`.

This softly biases regeneration toward refinement, not wholesale rewrite. It does NOT prevent rewrite — the operator can always accept or discard.

## 7. UX

### 7.1 Buttons

In `EditMode`, the description block shows:

- Above all three textareas: a primary button **"Generate descriptions"** → calls with `languages` omitted.
- Beside each language's label ("Description UZ", etc.): a small circular **"↻"** icon button → calls with `languages: ["uz"]` / `["ru"]` / `["en"]` only.

### 7.2 States

- Idle: buttons active.
- Generating: buttons disabled, button text becomes "Generating…", textareas locked while request is in flight.
- Success: the returned fields replace textarea contents. Cursor does not jump. A small inline toast `Generated from Wikipedia` or `Generated from name only` fades for 3 s.
- Error: textareas remain unchanged. Red inline message under the button with the error from §4.3. The button is re-enabled.

### 7.3 Save

No change to save logic. The existing PATCH flow persists whatever is in the textareas.

## 8. Observability

Every call appends to `events`:

```ts
{
  eventType: "admin.description_generated",
  metadata: {
    celebrityId,
    model,
    languages: ["uz", "ru", "en"],
    latencyMs,
    inputTokens,
    outputTokens,
    source: "wikipedia" | "none",
    success: boolean,
    errorCode?: string
  }
}
```

This feeds into the existing admin dashboard and gives us "N descriptions generated this week", "average latency", and rough cost estimates without any new infra.

## 9. Testing

The repo has no test suite (per `CLAUDE.md`: "The correctness gates are typecheck and lint"). We do not introduce one in this sub-project.

Manual validation checklist, to be executed against prod before marking done:

1. Generate descriptions for a celebrity with `wikidataId` — all three languages return plausible text, `source: "wikipedia"`.
2. Generate for a celebrity **without** `wikidataId` — all three return, `source: "none"`.
3. Regenerate a single field — only that field changes, others untouched.
4. Generate then click Cancel (don't Save) — D1 row is unchanged.
5. Generate then click Save — PATCH goes through, values persist.
6. Kill network during request — UI shows error, does not corrupt form state.
7. Invalid `GEMINI_API_KEY` — 502 surfaced cleanly.
8. Double-click "Generate" rapidly — only one request, button disabled immediately.

`typecheck` and `lint` must pass.

## 10. Security

- Endpoint is behind Basic Auth middleware (existing `/api/admin/*` matcher).
- `GEMINI_API_KEY` never leaves the Worker. The client receives only generated text.
- No user-generated content is fed to the LLM in this path. Celebrities are internal data. Prompt injection surface is negligible (Wikipedia extracts could theoretically inject, but the worst case is a weird description — operator reviews before saving).
- Log metadata does not include the generated text (only metrics). If we ever need to debug outputs, we add a short-TTL debug log, not a permanent one.

## 11. Cost / capacity

Per-generation cost on Flash-Lite: sub-cent. Paid-tier rate limits (Tier 1 ≈ 150 RPM based on current public docs — to be confirmed at plan time) far exceed what a single operator will ever hit manually. We do not need client-side throttling for MVP.

If future sub-project D (bulk import) triggers generation for 500+ celebs at once, that caller is responsible for its own rate management (e.g., serial calls or batch-mode endpoint). This route stays simple.

## 12. Open items to resolve at plan time

1. **Exact model ID.** Confirm `gemini-3-flash-lite` vs `gemini-3-1-flash-lite` vs `gemini-2.5-flash-lite` against current docs with WebFetch. Update `wrangler.toml` default accordingly.
2. **Paid-tier limits.** Confirm actual RPM/TPM at Tier 1; if lower than assumed, add a simple sliding-window limiter in `lib/llm/gemini.ts`.
3. **Structured-output syntax.** Verify the exact `generationConfig.responseSchema` field naming (`responseSchema` vs `response_schema`) against current API reference.
4. **`safetySettings` category strings.** Confirm exact string constants (`HARM_CATEGORY_HARASSMENT` etc.) and allowed threshold values.

These do not affect the design — only the concrete call site in `lib/llm/gemini.ts`.

## 13. Sequencing

Suggested order (for the implementation plan):

1. Add `GEMINI_MODEL` var + `GEMINI_API_KEY` secret; regenerate types.
2. Implement `lib/llm/schema.ts` + `lib/llm/prompts.ts` (pure functions).
3. Implement `lib/wikipedia.ts` (standalone, testable manually).
4. Implement `lib/llm/gemini.ts` wrapping the native endpoint.
5. Wire the Worker route; return 501 stub first, swap to real impl.
6. Wire the UI buttons in `EditMode`. Manual smoke in `next dev` against remote bindings.
7. Add the `events` log entry.
8. Deploy to prod, run the §9 manual checklist.

Each step is independently verifiable.

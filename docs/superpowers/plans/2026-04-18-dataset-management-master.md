# Dataset Management Tool — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Each phase is independently executable; pick the order by business value.

**Goal:** Build a comprehensive admin tool in `apps/web/app/admin/*` for creating and extending the celebrities dataset. Covers CRUD polish, LLM-powered description generation, auto photo search from Wikipedia Commons, and bulk import from Wikidata. Runs entirely online on Cloudflare Pages — no local daemons, no `scripts/seed/*` for day-to-day work.

**Architecture:** Admin pages and API routes are ordinary Next.js + Cloudflare Worker code. Heavy LLM/scrape calls run server-side via HTTPS (respects the project's `No server-side ML` rule). Face detection and embedding stay in the admin operator's browser via `onnxruntime-web` (identical pipeline to the kiosk). Persistence is direct to prod bindings: every save, enroll, and description commit hits the real D1 / R2 / Vectorize immediately.

**Tech Stack:** Next.js 15 App Router on Cloudflare Pages via `@opennextjs/cloudflare`, Drizzle ORM → D1, Zod, React 19, `onnxruntime-web` (WebGPU-first), Gemini 3.1 Flash Lite (`generativelanguage.googleapis.com`), Wikipedia/Commons/Wikidata REST + SPARQL APIs.

**Project test policy (from CLAUDE.md):** no test suite. Correctness gates are `pnpm --filter @starface/web typecheck` and `pnpm --filter @starface/web lint` plus manual smoke. No pytest/jest in these tasks.

**Commit format (from user's global CLAUDE.md):** Conventional Commits `type: description`. No `Co-Authored-By`. No emojis.

**Design references:**
- Phase B (fully specified): [docs/superpowers/specs/2026-04-18-gemini-description-generation-design.md](../specs/2026-04-18-gemini-description-generation-design.md)
- Phases A, C, D: design decisions inline in this plan (lightweight — each phase stands on its own).

---

## Global decisions (recap from brainstorm)

| # | Decision | Why |
|---|---|---|
| 1 | All online, admin UI deployed to prod | No local-only gating; ops from any desktop browser |
| 2 | Sync model: X (direct write) | One source of truth = prod. No staging, no publish flag |
| 3 | Gemini 3.1 Flash Lite, paid tier | No free-tier rate limits to engineer around; ~$0.0006/celeb |
| 4 | `x-goog-api-key` header (not `?key=` query) | Keeps API key out of Cloudflare access logs |
| 5 | Browser-side face embedding | Respects `No server-side ML` hard rule; reuses kiosk pipeline |
| 6 | WebGPU → WebGL → WASM fallback | 5–10× speedup on MobileFaceNet without breaking anyone |
| 7 | Preview-first for every LLM output | Operator reviews before save; no accidental overwrites |
| 8 | `scripts/seed/*` is deprecated (kept frozen) | Online flow replaces it; delete after Phase D is solid |

---

## Phase order

Default execution order:

1. **Phase B** — Description generation. Fastest user-visible win. No dependency on any other phase.
2. **Phase A** — Foundation polish (WebGPU, pagination, file split, dedicated page, copy). Unblocks Phases C and D from scaling problems.
3. **Phase C** — Auto photo search. Small and orthogonal. Reused inside Phase D.
4. **Phase D** — Bulk import wizard. Largest and depends on B (descriptions for imported celebs) and C (photos for imported celebs).

Phases A–C are independently shippable. Phase D is the finale.

---

## Phase A — Foundation Fix

### Goal

Prepare the existing admin CRUD for scale and readability: swap in WebGPU, add server-side pagination, split the 738-line `CelebritiesList.tsx`, and introduce a shareable `/admin/celebrities/[id]` URL. No new subsystems — only polish that every later phase benefits from.

### Design decisions

- **WebGPU fallback chain.** `executionProviders: ["wasm"]` in [apps/web/lib/face-embed.ts:86](../../apps/web/lib/face-embed.ts) becomes `["webgpu", "webgl", "wasm"]`. ORT handles compatibility.
- **Pagination is URL-based.** `/admin/celebrities?q=&cat=&page=&size=` — SSR, Next.js Link for navigation. No client-side data fetching.
- **Dedicated detail page is additive, not a replacement.** The grid still opens a quick-look modal (fast). "Open full page" in the modal navigates to `/admin/celebrities/[id]`, which is a full-width SSR page with the same ViewMode. Operators can share links. Edit mode moves to the full page.
- **File split map:** break `apps/web/app/admin/celebrities/CelebritiesList.tsx` into these files (same dir):
  - `CelebritiesList.tsx` — top-level list + filters + grid
  - `CelebrityCard.tsx`
  - `CelebrityModal.tsx` (quick view only; routes to full page on edit)
  - `ViewMode.tsx`
  - `EditMode.tsx`
  - `DescField.tsx`
  - `PhotoGallery.tsx`
  - `types.ts` (shared types that were inline)
  - `upload-helpers.ts` (fileToBitmap, readFileAsBase64)

### File structure

**New:**
- `apps/web/app/admin/celebrities/[id]/page.tsx`
- `apps/web/app/admin/celebrities/CelebrityCard.tsx`
- `apps/web/app/admin/celebrities/CelebrityModal.tsx`
- `apps/web/app/admin/celebrities/ViewMode.tsx`
- `apps/web/app/admin/celebrities/EditMode.tsx`
- `apps/web/app/admin/celebrities/DescField.tsx`
- `apps/web/app/admin/celebrities/PhotoGallery.tsx`
- `apps/web/app/admin/celebrities/types.ts`
- `apps/web/app/admin/celebrities/upload-helpers.ts`

**Modified:**
- `apps/web/lib/face-embed.ts` (WebGPU + minor)
- `apps/web/app/admin/celebrities/page.tsx` (pagination + copy)
- `apps/web/app/admin/celebrities/CelebritiesList.tsx` (shrunk to orchestration)

### Task A1: WebGPU backend for embedding

**Files:** `apps/web/lib/face-embed.ts`

- [ ] **Step 1: Swap execution providers**

In `apps/web/lib/face-embed.ts`, find `getSession()` at line 80 and change `executionProviders: ["wasm"]` to `["webgpu", "webgl", "wasm"]`. No other changes — ORT auto-falls-back.

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/lib/face-embed.ts
git commit -m "perf: use webgpu/webgl/wasm fallback for mobilefacenet embed"
```

Manual smoke: open `/admin/celebrities`, pick any celeb, upload a photo. Browser console should have no new errors. On Chrome, `chrome://gpu` shows WebGPU status.

### Task A2: Remove outdated CLI hint

**Files:** `apps/web/app/admin/celebrities/page.tsx:74-78`

- [ ] **Step 1: Delete the `<p>` block**

Remove:

```tsx
      <p className="text-sm text-neutral-500">
        Use the local seed CLI (<code>pnpm tsx scripts/seed/enroll.ts</code>) for bulk loads; this
        UI is for inspection and per-celebrity photo tweaks only.
      </p>
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/app/admin/celebrities/page.tsx
git commit -m "docs: remove stale local-cli hint from celebrities list"
```

### Task A3: Server-side pagination + search

**Files:** `apps/web/app/admin/celebrities/page.tsx`

- [ ] **Step 1: Read query params and paginate**

Replace the whole `CelebritiesListPage` default export with:

```tsx
import { and, count, desc, eq, like, or } from "drizzle-orm";
import Link from "next/link";

import { db, schema } from "@/lib/db";
import { CelebritiesList, type CelebrityRow } from "./CelebritiesList";

export const dynamic = "force-dynamic";

const DEFAULT_SIZE = 60;
const MAX_SIZE = 200;
const CATEGORIES = ["uz", "cis", "world"] as const;

type SearchParams = Promise<{
  q?: string;
  cat?: string;
  page?: string;
  size?: string;
}>;

export default async function CelebritiesListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const cat = CATEGORIES.includes(sp.cat as typeof CATEGORIES[number])
    ? (sp.cat as typeof CATEGORIES[number])
    : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = Math.min(MAX_SIZE, Math.max(1, Number(sp.size ?? DEFAULT_SIZE) || DEFAULT_SIZE));
  const offset = (page - 1) * size;

  const filters = and(
    cat ? eq(schema.celebrities.category, cat) : undefined,
    q
      ? or(
          like(schema.celebrities.name, `%${q}%`),
          like(schema.celebrities.nameRu, `%${q}%`),
          like(schema.celebrities.descriptionUz, `%${q}%`),
          like(schema.celebrities.descriptionRu, `%${q}%`),
          like(schema.celebrities.descriptionEn, `%${q}%`),
        )
      : undefined,
  );

  const [[total], celebs] = await Promise.all([
    db.select({ c: count() }).from(schema.celebrities).where(filters),
    db
      .select()
      .from(schema.celebrities)
      .where(filters)
      .orderBy(desc(schema.celebrities.createdAt))
      .limit(size)
      .offset(offset),
  ]);

  const celebIds = celebs.map((c) => c.id);
  const photos = celebIds.length
    ? await db
        .select({
          id: schema.celebrityPhotos.id,
          celebrityId: schema.celebrityPhotos.celebrityId,
          photoPath: schema.celebrityPhotos.photoPath,
          isPrimary: schema.celebrityPhotos.isPrimary,
          faceQuality: schema.celebrityPhotos.faceQuality,
          createdAt: schema.celebrityPhotos.createdAt,
        })
        .from(schema.celebrityPhotos)
        .where(
          celebIds.length === 1
            ? eq(schema.celebrityPhotos.celebrityId, celebIds[0])
            : (/* in */ undefined as never),
        )
    : [];
  // drizzle's inArray:
  // import { inArray } from "drizzle-orm"; and use inArray(schema.celebrityPhotos.celebrityId, celebIds)

  // ... build photosByCeleb, rows (same mapping as today) ...

  const totalPages = Math.max(1, Math.ceil(total.c / size));
  // render filters + grid + pagination bar with Link hrefs that preserve q/cat
}
```

Notes for implementer: use `inArray(schema.celebrityPhotos.celebrityId, celebIds)` for the photos query — the pseudo-code above is a reminder, not final code. Keep the existing row-mapping (photos into `photosByCeleb`, primary detection, etc.) intact.

The filters UI (search box + category buttons) moves out of client state into URL state: form `method="get"` posts to the current page, category buttons are `<Link>` with the updated `cat` param. `CelebritiesList` component becomes a simple renderer of `CelebrityRow[]` — it no longer filters.

- [ ] **Step 2: Update `CelebritiesList` to drop client-side filtering**

In `apps/web/app/admin/celebrities/CelebritiesList.tsx` (before the Task A4 split), delete the `query/category` state, the `filtered` memoisation, and the `<input>`/category buttons. These now come from the parent page via URL params. `CelebritiesList` reduces to the grid + modal.

After A4 splits the file, this also moves into `CelebritiesList.tsx` as a tiny component.

- [ ] **Step 3: Add pagination bar**

In the list page, below the grid, render:

```tsx
<nav className="flex items-center justify-center gap-2 pt-4 text-sm">
  {page > 1 && (
    <Link
      href={`/admin/celebrities?${buildQuery({ q, cat, page: page - 1, size })}`}
      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5"
    >
      ← Prev
    </Link>
  )}
  <span className="px-2 text-neutral-500">
    Page {page} / {totalPages} ({total.c} total)
  </span>
  {page < totalPages && (
    <Link
      href={`/admin/celebrities?${buildQuery({ q, cat, page: page + 1, size })}`}
      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5"
    >
      Next →
    </Link>
  )}
</nav>
```

`buildQuery` is a tiny local helper (3–5 lines, `URLSearchParams`).

- [ ] **Step 4: Typecheck + lint + manual smoke + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
```

Manual smoke: `/admin/celebrities?q=muhamm&cat=uz&page=1&size=12` returns matching celebs; pagination bar shows correct total.

```bash
git add apps/web/app/admin/celebrities/page.tsx apps/web/app/admin/celebrities/CelebritiesList.tsx
git commit -m "feat: server-side pagination and search on celebrities list"
```

### Task A4: Split `CelebritiesList.tsx`

**Files:** create 8 new files listed in the File structure above; shrink `CelebritiesList.tsx`.

- [ ] **Step 1: Create `types.ts` with shared types**

Move `CelebrityPhotoMini`, `CelebrityRow`, `CelebrityDetail` here. Re-export from `CelebritiesList.tsx` for backward compatibility of existing imports (`app/admin/celebrities/page.tsx` imports `CelebrityRow` by name).

- [ ] **Step 2: Create `upload-helpers.ts`**

Move `fileToBitmap` and `readFileAsBase64`.

- [ ] **Step 3–8: Move components**

One file per component: `CelebrityCard`, `CelebrityModal`, `ViewMode`, `EditMode`, `DescField`, `PhotoGallery`. Each file:

- `"use client"` at top (all these are client components)
- Imports from `./types` / `./upload-helpers` / `@/lib/face-embed` as needed
- Exports the single component as default or named

Keep behaviour identical. Do not refactor logic in this task — pure file split.

- [ ] **Step 9: Shrink `CelebritiesList.tsx`**

It should end up as a short list-of-rows renderer + modal opener. Roughly:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CelebrityCard } from "./CelebrityCard";
import { CelebrityModal } from "./CelebrityModal";
import type { CelebrityRow } from "./types";

export type { CelebrityRow } from "./types";

export function CelebritiesList({ celebrities }: { celebrities: CelebrityRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<CelebrityRow | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {celebrities.map((c) => (
          <CelebrityCard key={c.id} celeb={c} onOpen={() => setSelected(c)} />
        ))}
        {celebrities.length === 0 && (
          <p className="col-span-full rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-400">
            Nothing matches the filter.
          </p>
        )}
      </div>
      {selected && (
        <CelebrityModal
          celebrityId={selected.id}
          initialName={selected.name}
          onClose={() => {
            setSelected(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 10: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/admin/celebrities/
git commit -m "refactor: split celebrities admin components into separate files"
```

### Task A5: Dedicated `/admin/celebrities/[id]` page

**Files:**
- Create: `apps/web/app/admin/celebrities/[id]/page.tsx`
- Modify: `apps/web/app/admin/celebrities/CelebrityModal.tsx` (add "Open full page" link)
- Modify: `apps/web/app/admin/celebrities/ViewMode.tsx` and `EditMode.tsx` (accept a `standalone` prop)

- [ ] **Step 1: Create the SSR page**

`apps/web/app/admin/celebrities/[id]/page.tsx`:

```tsx
import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db, schema } from "@/lib/db";
import { CelebrityPage } from "./CelebrityPage";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [celeb] = await db
    .select()
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) notFound();

  const photos = await db
    .select({
      id: schema.celebrityPhotos.id,
      photoPath: schema.celebrityPhotos.photoPath,
      isPrimary: schema.celebrityPhotos.isPrimary,
      faceQuality: schema.celebrityPhotos.faceQuality,
      detScore: schema.celebrityPhotos.detScore,
      createdAt: schema.celebrityPhotos.createdAt,
    })
    .from(schema.celebrityPhotos)
    .where(eq(schema.celebrityPhotos.celebrityId, id))
    .orderBy(desc(schema.celebrityPhotos.isPrimary), asc(schema.celebrityPhotos.createdAt));

  return (
    <div className="space-y-4">
      <Link href="/admin/celebrities" className="text-sm text-neutral-500 hover:underline">
        ← Back to list
      </Link>
      <CelebrityPage
        initial={{
          id: celeb.id,
          name: celeb.name,
          nameRu: celeb.nameRu,
          category: celeb.category,
          descriptionUz: celeb.descriptionUz,
          descriptionRu: celeb.descriptionRu,
          descriptionEn: celeb.descriptionEn,
          wikidataId: celeb.wikidataId,
          active: Boolean(celeb.active),
          createdAt: celeb.createdAt ? celeb.createdAt.toISOString() : null,
          photos: photos.map((p) => ({
            id: p.id,
            photoUrl: `/api/files/${p.photoPath}`,
            photoPath: p.photoPath,
            isPrimary: p.isPrimary,
            faceQuality: p.faceQuality,
            detScore: p.detScore,
            createdAt: p.createdAt ? p.createdAt.toISOString() : null,
          })),
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `CelebrityPage.tsx` — client wrapper**

Thin client component that reuses `ViewMode` / `EditMode`. It holds the mode state and re-fetches on change. Roughly 50 lines; mirrors the inner logic of `CelebrityModal.tsx` minus the modal chrome.

- [ ] **Step 3: Add "Open full page" in the modal**

In `CelebrityModal.tsx` ViewMode header, add next to the Edit button:

```tsx
<Link
  href={`/admin/celebrities/${detail.id}`}
  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
>
  Open full page
</Link>
```

- [ ] **Step 4: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/admin/celebrities/[id]/ apps/web/app/admin/celebrities/CelebrityModal.tsx
git commit -m "feat: dedicated celebrity detail page with shareable url"
```

### Phase A coverage check

- WebGPU → Task A1
- CLI hint copy → Task A2
- Pagination + search → Task A3
- File split → Task A4
- Dedicated detail page → Task A5

---

## Phase B — Description Generation (Gemini)

### Goal

One-click generation (and per-language regeneration) of `descriptionUz / descriptionRu / descriptionEn` from the edit form, using Gemini 3.1 Flash Lite with optional Wikipedia grounding. Preview-first — values land in the form textareas only, not persisted until the operator saves.

### Design

Full design lives in [docs/superpowers/specs/2026-04-18-gemini-description-generation-design.md](../specs/2026-04-18-gemini-description-generation-design.md). Key decisions recap:

- `POST /api/admin/celebrities/[id]/generate-description` Worker route
- Optional wiki grounding: 1 Wikidata call (`?props=sitelinks`) + up to 3 per-language summary calls (`api/rest_v1/page/summary/...`), `AbortController` timeout 4s each
- Gemini native endpoint, `x-goog-api-key` header, `responseJsonSchema` structured output
- One retry on 429/5xx with `setTimeout`-based delay
- Zod parse of JSON response
- Events row logged with tokens/latency/source/success
- UI: one "Generate descriptions" button (all three) + per-language `↻` (single)

### Plan-time facts locked in

From API research (2026-04-18):

- **Model ID:** `gemini-3.1-flash-lite`
- **Structured output field:** `responseJsonSchema` (NOT `responseSchema`)
- **Property types in schema:** lowercase (`"string"`, `"object"`)
- **Safety setting categories:** `HARM_CATEGORY_HARASSMENT`, `HARM_CATEGORY_HATE_SPEECH`, `HARM_CATEGORY_SEXUALLY_EXPLICIT`, `HARM_CATEGORY_DANGEROUS`; placement at root level (REST). MVP uses defaults.
- **Paid-tier rate limits:** variable per account, visible in AI Studio console. For this MVP we do not add throttling; 429 is handled with one retry + clean error to UI.

### File structure

**New:**
- `apps/web/lib/llm/schema.ts`
- `apps/web/lib/llm/prompts.ts`
- `apps/web/lib/llm/gemini.ts`
- `apps/web/lib/wikipedia.ts`
- `apps/web/app/api/admin/celebrities/[id]/generate-description/route.ts`

**Modified:**
- `apps/web/wrangler.toml` (add `GEMINI_MODEL` var)
- `apps/web/cloudflare-env.d.ts` (regenerated)
- `apps/web/app/admin/celebrities/EditMode.tsx` (Generate buttons — location after Task A4's file split; before A4 it's lines ~343–503 of `CelebritiesList.tsx`)
- `apps/web/app/admin/celebrities/DescField.tsx` (add `onRegenerate` prop)
- `CLAUDE.md` (doc new var + secret)

### Task B1: Add `GEMINI_MODEL` var

**Files:** `apps/web/wrangler.toml`, `apps/web/cloudflare-env.d.ts`

- [ ] **Step 1: Add to `[vars]`**

In `apps/web/wrangler.toml` under `[vars]`:

```toml
GEMINI_MODEL = "gemini-3.1-flash-lite"
```

- [ ] **Step 2: Regenerate types**

```bash
pnpm --filter @starface/web cf-typegen
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/wrangler.toml apps/web/cloudflare-env.d.ts
git commit -m "feat: add GEMINI_MODEL binding for description generation"
```

### Task B2: Zod schema + language helpers

**Files:** `apps/web/lib/llm/schema.ts`

- [ ] **Step 1: Create file**

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
  const properties: Record<string, { type: "string" }> = {};
  for (const lang of languages) properties[lang] = { type: "string" };
  return {
    type: "object" as const,
    properties,
    required: languages,
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/lib/llm/schema.ts
git commit -m "feat: add zod schema and language helpers for generated descriptions"
```

### Task B3: Prompt builder

**Files:** `apps/web/lib/llm/prompts.ts`

- [ ] **Step 1: Create file**

See design spec §5.4 for the canonical prompt. Implementation:

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

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/lib/llm/prompts.ts
git commit -m "feat: add description prompt builder with xml-delimited excerpts"
```

### Task B4: Wikipedia client

**Files:** `apps/web/lib/wikipedia.ts`

- [ ] **Step 1: Create file**

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
    const data = (await res.json()) as { entities?: Record<string, { sitelinks?: SitelinkMap }> };
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

export async function fetchSummaries(wikidataId: string, langs: Language[]): Promise<WikipediaSummaries> {
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

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/lib/wikipedia.ts
git commit -m "feat: add wikipedia summary client with sitelinks lookup"
```

### Task B5: Gemini client

**Files:** `apps/web/lib/llm/gemini.ts`

- [ ] **Step 1: Create file**

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

export type GeminiErrorCode = "rate_limited" | "safety_blocked" | "upstream_error" | "parse_error";

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

async function callOnce(apiKey: string, model: string, prompt: string, languages: Language[]): Promise<Response> {
  return await fetch(endpoint(model), {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
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
    throw new GeminiError("upstream_error", `HTTP ${response.status}`, { detail: body.slice(0, 500) });
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
    throw new GeminiError("safety_blocked", "prompt blocked", { detail: raw.promptFeedback.blockReason });
  }
  const candidate = raw.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) {
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new GeminiError("safety_blocked", "empty response", { detail: candidate.finishReason });
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

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/lib/llm/gemini.ts
git commit -m "feat: add gemini client with retry and structured output parsing"
```

### Task B6: Route handler

**Files:** `apps/web/app/api/admin/celebrities/[id]/generate-description/route.ts`

- [ ] **Step 1: Create route**

See the full code in the prior narrow plan draft (now folded into this master plan). It: parses body, loads celeb, optionally fetches Wikipedia, builds prompt, calls `generateDescriptions`, inserts an `events` row with `brandId: null` and `resultId: null` (per spec §8), translates `GeminiError` to HTTP status (429/422/502/500), returns the generated languages.

```ts
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { GeminiError, generateDescriptions } from "@/lib/llm/gemini";
import { buildDescriptionPrompt, type CelebrityInput, type WikipediaContext } from "@/lib/llm/prompts";
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
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json({ error: "bad_request", detail: (e as Error).message }, { status: 400 });
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
    return NextResponse.json({ error: "internal", detail: "GEMINI_API_KEY missing" }, { status: 500 });
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
    if (errorCode === "rate_limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (errorCode === "safety_blocked") return NextResponse.json({ error: "safety_blocked" }, { status: 422 });
    if (errorCode === "parse_error") return NextResponse.json({ error: "internal", detail: "parse_error" }, { status: 500 });
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
  const missing = languages.filter((l) => !result!.descriptions[l]);
  if (missing.length > 0) {
    return NextResponse.json({ error: "internal", detail: `missing_languages:${missing.join(",")}` }, { status: 500 });
  }
  return NextResponse.json({ ...result.descriptions, source, model, latencyMs });
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/api/admin/celebrities/[id]/generate-description/route.ts
git commit -m "feat: add route for gemini-powered description generation"
```

### Task B7: UI — Generate buttons

**Files:**
- `apps/web/app/admin/celebrities/EditMode.tsx`
- `apps/web/app/admin/celebrities/DescField.tsx`

(If Phase A has not run yet, these edits happen inside `CelebritiesList.tsx` at lines 343–503 and 505–525 respectively.)

- [ ] **Step 1: Add generate state + function in `EditMode`**

Add, after existing `useState`s:

```tsx
type GenLang = "uz" | "ru" | "en";
type GenTarget = "all" | GenLang;

const [genTarget, setGenTarget] = useState<GenTarget | null>(null);
const [genError, setGenError] = useState<string | null>(null);
const [genSource, setGenSource] = useState<"wikipedia" | "none" | null>(null);

async function generate(target: GenTarget) {
  const languages: GenLang[] | undefined = target === "all" ? undefined : [target];
  setGenTarget(target);
  setGenError(null);
  try {
    const res = await fetch(`/api/admin/celebrities/${detail.id}/generate-description`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(languages ? { languages } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as {
      uz?: string; ru?: string; en?: string;
      source?: "wikipedia" | "none";
      error?: string; detail?: string;
    };
    if (!res.ok) {
      setGenError(
        data.error === "rate_limited" ? "Rate limited, try again in a moment." :
        data.error === "safety_blocked" ? "Gemini blocked the response (safety filter)." :
        data.error === "upstream_error" ? "Gemini API error. Try again." :
        data.error ?? `HTTP ${res.status}`
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

Replace the `<div className="space-y-3"> <h3>Descriptions</h3> <DescField .../> ×3 </div>` with:

```tsx
<div className="space-y-3">
  <div className="flex items-center justify-between">
    <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">Descriptions</h3>
    <div className="flex items-center gap-2">
      {genSource && !genError && (
        <span className="text-xs text-neutral-500">
          {genSource === "wikipedia" ? "Generated from Wikipedia" : "Generated from name only"}
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
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{genError}</p>
  )}
  <DescField label="Uzbek" value={descUz} onChange={setDescUz}
    onRegenerate={() => void generate("uz")}
    regenerating={genTarget === "uz" || genTarget === "all"} />
  <DescField label="Russian" value={descRu} onChange={setDescRu}
    onRegenerate={() => void generate("ru")}
    regenerating={genTarget === "ru" || genTarget === "all"} />
  <DescField label="English" value={descEn} onChange={setDescEn}
    onRegenerate={() => void generate("en")}
    regenerating={genTarget === "en" || genTarget === "all"} />
</div>
```

- [ ] **Step 3: Extend `DescField`**

```tsx
export function DescField({
  label, value, onChange, onRegenerate, regenerating,
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
          <button type="button" onClick={onRegenerate} disabled={regenerating}
            aria-label={`Regenerate ${label} description`}
            title={`Regenerate ${label}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-[10px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40">
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

- [ ] **Step 4: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/admin/celebrities/
git commit -m "feat: add generate and regenerate buttons to celebrity edit form"
```

### Task B8: Local smoke

**Files:** `apps/web/.dev.vars` (local, not in git)

Prereqs: `next dev` configured with remote bindings (see existing session notes on `experimental: { remoteBindings: true }`).

- [ ] **Step 1: Add key locally**

Append to `apps/web/.dev.vars`:

```
GEMINI_API_KEY=<your Google AI Studio key>
```

Obtain at https://aistudio.google.com/app/apikey.

- [ ] **Step 2: Run `next dev` and smoke**

```bash
pnpm --filter @starface/web dev
```

Checklist in the browser at `http://127.0.0.1:3000/admin/celebrities`:

1. Open a celeb with `wikidataId`, Edit → Generate descriptions → three textareas fill, "Generated from Wikipedia" badge shows.
2. Open a celeb without `wikidataId` → Generate → three textareas fill, "Generated from name only".
3. Click per-field ↻ on Russian → only RU changes.
4. Rename `GEMINI_API_KEY` in `.dev.vars` → restart → Generate → red banner `GEMINI_API_KEY missing`. Restore, restart.
5. Verify events in D1:

```bash
cd apps/web
npx wrangler d1 execute starface --remote --command "SELECT event_type, metadata, created_at FROM events WHERE event_type = 'admin.description_generated' ORDER BY id DESC LIMIT 5;"
```

No commit — smoke only.

### Task B9: Prod rollout

**Files:** `CLAUDE.md`; prod secret.

**STOP before Step 3 — get user confirmation.** (User's global rule: `Не пушь без моего подтверждения`.)

- [ ] **Step 1: Update `CLAUDE.md` config reference**

Add `GEMINI_MODEL` to vars list and `GEMINI_API_KEY` to secrets list in the "Config reference" section.

- [ ] **Step 2: Commit doc**

```bash
git add CLAUDE.md
git commit -m "docs: note GEMINI_MODEL var and GEMINI_API_KEY secret"
```

- [ ] **Step 3: Ask user to confirm deploy**

Say: "Ready to deploy. Next steps write the prod secret and deploy. Confirm before I run them."

- [ ] **Step 4 (after user confirms): Set prod secret**

```bash
cd apps/web
npx wrangler secret put GEMINI_API_KEY
```

- [ ] **Step 5: Deploy**

```bash
pnpm --filter @starface/web deploy
```

- [ ] **Step 6: Prod smoke**

Repeat B8 checklist items 1–3 against prod URL. Check events in remote D1.

### Phase B coverage check

- Model/secret config → B1
- Schema/prompts/clients → B2, B3, B4, B5
- Route → B6
- UI → B7
- Smoke + rollout → B8, B9

---

## Phase C — Auto Photo Search

### Goal

For a selected celebrity, surface candidate photos from Wikipedia Commons (main `P18` + optional Commons category gallery). Operator reviews a grid, selects N. Browser downloads via Worker proxy, detects+embeds, posts to existing photos endpoint.

### Design decisions

- **Sources:** Wikidata `P18` (main image) first. If Wikidata commons-category `P373` is set, list up to 20 files from that category via the MediaWiki API. Skip parsing Wikipedia HTML for images (MVP).
- **Worker proxy for images:** browsers can't always download Wikimedia thumbnails cross-origin for decoded-canvas use (CORB). A small Worker proxy at `GET /api/admin/fetch-image?url=...` refuses URLs outside `upload.wikimedia.org` and streams bytes through.
- **Filter:** hide files with width < 300 or height < 300.
- **Quality signals:** file size + dimensions from Commons; after browser detect+embed, reject if `detScore < 0.6` or no face. Show soft-fail in the gallery.
- **Reused enroll path:** once embedded, POST to existing `/api/admin/celebrities/[id]/photos` batch endpoint. No schema changes required.

### File structure

**New:**
- `apps/web/lib/commons.ts` — Wikimedia Commons + Wikidata `P18/P373` resolvers
- `apps/web/app/api/admin/fetch-image/route.ts` — Worker image proxy (hard-whitelisted to `upload.wikimedia.org`)
- `apps/web/app/api/admin/celebrities/[id]/photo-candidates/route.ts` — returns candidate list for a celeb
- `apps/web/app/admin/celebrities/FindPhotosModal.tsx` — grid + selection + orchestrator

**Modified:**
- `apps/web/app/admin/celebrities/PhotoGallery.tsx` (add "Find more photos" button that opens the modal)

### Task C1: Commons + Wikidata resolvers

**Files:** `apps/web/lib/commons.ts`

- [ ] **Step 1: Create file**

```ts
const FETCH_TIMEOUT_MS = 4000;

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "starface-admin/1.0 (dataset enrichment)" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type PhotoCandidate = {
  id: string;         // unique opaque (e.g., `p18:Foo.jpg` or `cat:Bar.jpg`)
  fileName: string;   // Commons title without `File:`
  fullUrl: string;    // upload.wikimedia.org/...
  thumbUrl: string;
  width: number;
  height: number;
  sourceUrl: string;  // https://commons.wikimedia.org/wiki/File:...
  sourceType: "p18" | "category";
  license: string | null;
};

const wikidataEntity = (qid: string) =>
  `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(qid)}.json?props=claims`;

type WikidataClaims = {
  entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>> }>;
};

async function getClaim(qid: string, property: string): Promise<string | null> {
  const data = await fetchJson<WikidataClaims>(wikidataEntity(qid));
  const claim = data?.entities?.[qid]?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  return typeof claim === "string" ? claim : null;
}

const commonsImageInfo = (filenames: string[]) => {
  const titles = filenames.map((f) => `File:${f}`).join("|");
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    titles,
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "512",
  });
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
};

type CommonsResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: Array<{
          url?: string;
          thumburl?: string;
          width?: number;
          height?: number;
          extmetadata?: { LicenseShortName?: { value?: string } };
        }>;
      }
    >;
  };
};

async function imageInfo(filenames: string[], sourceType: "p18" | "category"): Promise<PhotoCandidate[]> {
  if (filenames.length === 0) return [];
  const data = await fetchJson<CommonsResponse>(commonsImageInfo(filenames));
  const pages = Object.values(data?.query?.pages ?? {});
  const out: PhotoCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    const fileName = page.title?.replace(/^File:/, "");
    if (!info || !fileName || !info.url || !info.thumburl) continue;
    const width = info.width ?? 0;
    const height = info.height ?? 0;
    if (width < 300 || height < 300) continue;
    out.push({
      id: `${sourceType}:${fileName}`,
      fileName,
      fullUrl: info.url,
      thumbUrl: info.thumburl,
      width,
      height,
      sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`,
      sourceType,
      license: info.extmetadata?.LicenseShortName?.value ?? null,
    });
  }
  return out;
}

const commonsCategoryMembers = (cat: string) => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    list: "categorymembers",
    cmtitle: `Category:${cat}`,
    cmtype: "file",
    cmlimit: "30",
  });
  return `https://commons.wikimedia.org/w/api.php?${params.toString()}`;
};

type CategoryMembersResponse = {
  query?: { categorymembers?: Array<{ title?: string }> };
};

export async function findCandidatesForWikidata(qid: string): Promise<PhotoCandidate[]> {
  const p18 = await getClaim(qid, "P18");
  const p373 = await getClaim(qid, "P373");

  const p18Candidates = p18 ? await imageInfo([p18], "p18") : [];

  let catCandidates: PhotoCandidate[] = [];
  if (p373) {
    const members = await fetchJson<CategoryMembersResponse>(commonsCategoryMembers(p373));
    const fileNames = (members?.query?.categorymembers ?? [])
      .map((m) => m.title?.replace(/^File:/, ""))
      .filter((n): n is string => Boolean(n))
      .slice(0, 20);
    catCandidates = await imageInfo(fileNames, "category");
  }

  const seen = new Set<string>();
  const unique: PhotoCandidate[] = [];
  for (const c of [...p18Candidates, ...catCandidates]) {
    if (seen.has(c.fullUrl)) continue;
    seen.add(c.fullUrl);
    unique.push(c);
  }
  return unique;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/lib/commons.ts
git commit -m "feat: add wikimedia commons photo candidate resolver"
```

### Task C2: Image proxy route

**Files:** `apps/web/app/api/admin/fetch-image/route.ts`

- [ ] **Step 1: Create route**

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "commons.wikimedia.org"]);
const MAX_BYTES = 12 * 1024 * 1024;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "bad_url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:") return NextResponse.json({ error: "http_disallowed" }, { status: 400 });
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "host_disallowed", detail: parsed.hostname }, { status: 400 });
  }

  const upstream = await fetch(parsed.toString(), {
    headers: { "User-Agent": "starface-admin/1.0 (dataset enrichment)" },
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: "upstream", status: upstream.status }, { status: 502 });
  }
  const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!ct.startsWith("image/")) {
    return NextResponse.json({ error: "not_an_image", contentType: ct }, { status: 415 });
  }
  const lenHeader = upstream.headers.get("content-length");
  const len = lenHeader ? Number(lenHeader) : 0;
  if (len > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", bytes: len }, { status: 413 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/app/api/admin/fetch-image/route.ts
git commit -m "feat: add allowlisted wikimedia image proxy for admin tools"
```

### Task C3: Photo candidates route

**Files:** `apps/web/app/api/admin/celebrities/[id]/photo-candidates/route.ts`

- [ ] **Step 1: Create route**

```ts
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@/lib/db";
import { findCandidatesForWikidata } from "@/lib/commons";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [celeb] = await db
    .select({ wikidataId: schema.celebrities.wikidataId })
    .from(schema.celebrities)
    .where(eq(schema.celebrities.id, id))
    .limit(1);
  if (!celeb) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!celeb.wikidataId) return NextResponse.json({ candidates: [] });
  const candidates = await findCandidatesForWikidata(celeb.wikidataId);
  return NextResponse.json({ candidates });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/app/api/admin/celebrities/[id]/photo-candidates/route.ts
git commit -m "feat: add photo candidates route for celebrity"
```

### Task C4: FindPhotosModal UI

**Files:** `apps/web/app/admin/celebrities/FindPhotosModal.tsx`

- [ ] **Step 1: Create modal component**

The modal:
1. On open, `fetch(/api/admin/celebrities/:id/photo-candidates)`.
2. Render grid — checkbox + thumb + dims + license link.
3. "Import N selected" button — for each selected, orchestrate:
   - `fetch('/api/admin/fetch-image?url=' + encodeURIComponent(fullUrl))`
   - `const blob = await res.blob(); const bitmap = await createImageBitmap(blob);`
   - `const result = await detectAndEmbed(bitmap);`
   - Collect a payload array (same shape as `PhotoGallery.upload` POSTs today).
4. POST the whole batch to `/api/admin/celebrities/${id}/photos`.
5. Show per-candidate result: ✓ / ✗ code.

This is ~200 lines. Reuse `readFileAsBase64` / `fileToBitmap` patterns from Phase A's `upload-helpers.ts`.

Concurrency: serial loop is fine for up to ~20 candidates. Keep it simple.

- [ ] **Step 2: Wire from `PhotoGallery`**

In `PhotoGallery.tsx`, next to the "+ Add photos" button, add:

```tsx
<button
  onClick={() => setFindOpen(true)}
  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold"
>
  Find more photos
</button>
{findOpen && (
  <FindPhotosModal
    celebrityId={celebrityId}
    onClose={() => setFindOpen(false)}
    onImported={onChanged}
  />
)}
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/admin/celebrities/
git commit -m "feat: auto photo search modal backed by wikimedia commons"
```

### Task C5: Smoke

Against `next dev` with remote bindings:

1. Open a celeb with `wikidataId` set to a real Wikidata QID (e.g., `Q5`-ish for a real person). Click "Find more photos" → grid of candidates appears.
2. Select 2–3, click Import → browser embeds them, POSTs, photos gallery refreshes with new entries.
3. Open a celeb without `wikidataId` → modal opens with "No candidates" message.
4. Temporarily point the fetch-image URL at an off-allowlist host via devtools → 400.

### Phase C coverage check

- Candidate source (Wikidata + Commons) → C1
- CORS-free fetch → C2
- Per-celeb endpoint → C3
- UI → C4
- Smoke → C5

---

## Phase D — Bulk Import Wizard

### Goal

An `/admin/import` wizard for importing many celebrities from Wikidata at once. Operator picks a preset (e.g., "Uzbek actors") or enters custom SPARQL; worker runs the query; operator reviews the candidate list and toggles which to import; client orchestrator runs per-celeb pipeline (enrich → photos → embed → enroll → description). Progress tracked live; resumable after reload.

### Design decisions

- **Source:** Wikidata SPARQL via `https://query.wikidata.org/sparql?query=…&format=json`. Public, no auth, 60s timeout.
- **Worker role:** run SPARQL from Worker (simple `fetch`, bypasses CORS / User-Agent requirements). Return normalised candidate JSON.
- **Presets:** hard-coded SPARQL templates in `lib/wikidata-presets.ts`.
- **Client-side orchestrator:** `BulkImportOrchestrator.tsx` holds queue, parallelism 3, persists to `localStorage` every 5 completions. On reload, detects `in_progress` job and offers Resume.
- **Per-celeb steps in order:**
  1. Enrich metadata: name, nameRu, gender, birth/death year, P18 image title, P373 category. One `/api/admin/wikidata-resolve?qid=…` call per celeb.
  2. Fetch P18 image via `/api/admin/fetch-image` proxy.
  3. Detect+embed in browser.
  4. POST to `/api/admin/enroll` (existing batch endpoint) with a single-celeb batch.
  5. POST to `/api/admin/celebrities/:id/generate-description` (Phase B).
- **Idempotency:** existing `/api/admin/enroll` already dedupes by `wikidataId`. Re-running on the same QID updates, doesn't duplicate.
- **Failure policy:** per-step try/catch; errors logged in orchestrator state; celeb marked failed with reason; other celebs continue.
- **Not in MVP:** multi-photo per celeb (we take only P18). Operators can add more via Phase C after import. Reruns of failed-only subset via a "Retry failed" button; nothing fancier.
- **Not in MVP:** SSE. Client owns orchestration, state visible immediately.

### File structure

**New:**
- `apps/web/lib/wikidata-presets.ts` — SPARQL templates
- `apps/web/lib/wikidata-query.ts` — SPARQL helpers (Worker-side)
- `apps/web/app/api/admin/wikidata-query/route.ts` — POST to run a preset or custom SPARQL
- `apps/web/app/api/admin/wikidata-resolve/route.ts` — GET single QID details
- `apps/web/app/admin/import/page.tsx` — wizard container
- `apps/web/app/admin/import/PresetPicker.tsx` — Step 1
- `apps/web/app/admin/import/CandidateReview.tsx` — Step 2
- `apps/web/app/admin/import/BulkImportOrchestrator.tsx` — Step 3 (runner + progress)
- `apps/web/app/admin/import/types.ts`
- `apps/web/app/admin/import/storage.ts` — localStorage read/write helpers

**Modified:**
- `apps/web/app/admin/layout.tsx` (add Import nav link)

### Task D1: SPARQL presets + helpers

**Files:** `apps/web/lib/wikidata-presets.ts`, `apps/web/lib/wikidata-query.ts`

- [ ] **Step 1: Presets**

```ts
// lib/wikidata-presets.ts
export type WikidataPreset = {
  id: string;
  label: string;
  description: string;
  category: "uz" | "cis" | "world";
  sparql: string;
};

// NOTE: {{LIMIT}} placeholder is substituted at query time. Queries return
// vars: ?person, ?personLabel, ?personRuLabel, ?image, ?dob, ?dod,
// ?occupationLabel.

const PERSON_FIELDS = `
  OPTIONAL { ?person wdt:P18 ?image. }
  OPTIONAL { ?person wdt:P569 ?dob. }
  OPTIONAL { ?person wdt:P570 ?dod. }
  OPTIONAL { ?person wdt:P106 ?occupation. }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?person rdfs:label ?personLabel.
    ?occupation rdfs:label ?occupationLabel.
  }
  OPTIONAL {
    ?person rdfs:label ?personRuLabel.
    FILTER(LANG(?personRuLabel) = "ru").
  }
`;

export const PRESETS: WikidataPreset[] = [
  {
    id: "uz-actors",
    label: "Uzbek actors",
    description: "People with P27 (country of citizenship) = Uzbekistan, P106 (occupation) = actor/actress.",
    category: "uz",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel WHERE {
        ?person wdt:P31 wd:Q5.
        ?person wdt:P27 wd:Q265.
        VALUES ?job { wd:Q33999 wd:Q10800557 wd:Q10798782 }
        ?person wdt:P106 ?job.
        ${PERSON_FIELDS}
      } LIMIT {{LIMIT}}
    `,
  },
  {
    id: "uz-musicians",
    label: "Uzbek musicians",
    description: "P27 = Uzbekistan, P106 = musician / singer / composer.",
    category: "uz",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel WHERE {
        ?person wdt:P31 wd:Q5.
        ?person wdt:P27 wd:Q265.
        VALUES ?job { wd:Q177220 wd:Q639669 wd:Q36834 }
        ?person wdt:P106 ?job.
        ${PERSON_FIELDS}
      } LIMIT {{LIMIT}}
    `,
  },
  {
    id: "cis-actors",
    label: "CIS actors (RU/KZ/KG)",
    description: "Actors with P27 ∈ {Russia, Kazakhstan, Kyrgyzstan}.",
    category: "cis",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel WHERE {
        ?person wdt:P31 wd:Q5.
        VALUES ?country { wd:Q159 wd:Q232 wd:Q813 }
        ?person wdt:P27 ?country.
        VALUES ?job { wd:Q33999 wd:Q10800557 wd:Q10798782 }
        ?person wdt:P106 ?job.
        ${PERSON_FIELDS}
      } LIMIT {{LIMIT}}
    `,
  },
  {
    id: "world-actors",
    label: "World A-list actors",
    description: "Highly-linked actors (sitelinks >= 30).",
    category: "world",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        ?person wdt:P31 wd:Q5.
        VALUES ?job { wd:Q33999 wd:Q10800557 wd:Q10798782 }
        ?person wdt:P106 ?job.
        ?person wikibase:sitelinks ?sitelinks.
        FILTER(?sitelinks >= 30).
        ${PERSON_FIELDS}
      } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
    `,
  },
];
```

- [ ] **Step 2: Query helpers**

```ts
// lib/wikidata-query.ts
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const TIMEOUT_MS = 30_000;

export type RawCandidate = {
  qid: string;
  name: string;
  nameRu: string | null;
  imageFile: string | null;   // Commons file name (no "File:" prefix)
  dob: string | null;
  dod: string | null;
  occupation: string | null;
};

type SparqlResult = {
  results?: {
    bindings?: Array<Record<string, { value: string; type?: string }>>;
  };
};

function qidFromUri(uri: string): string | null {
  const m = /\/entity\/(Q\d+)$/.exec(uri);
  return m ? m[1] : null;
}

function imageFileFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const decoded = decodeURIComponent(uri.replace(/^.*\/Special:FilePath\//, ""));
  return decoded || null;
}

export async function runSparql(query: string, limit: number): Promise<RawCandidate[]> {
  const finalQuery = query.replaceAll("{{LIMIT}}", String(Math.min(1000, Math.max(1, limit))));
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(finalQuery)}&format=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "starface-admin/1.0 (dataset enrichment)",
        Accept: "application/sparql-results+json",
      },
    });
    if (!res.ok) throw new Error(`sparql_${res.status}`);
    const data = (await res.json()) as SparqlResult;
    const rows = data.results?.bindings ?? [];
    const seen = new Set<string>();
    const out: RawCandidate[] = [];
    for (const row of rows) {
      const qid = qidFromUri(row.person?.value ?? "");
      if (!qid || seen.has(qid)) continue;
      seen.add(qid);
      out.push({
        qid,
        name: row.personLabel?.value ?? qid,
        nameRu: row.personRuLabel?.value ?? null,
        imageFile: imageFileFromUri(row.image?.value),
        dob: row.dob?.value ?? null,
        dod: row.dod?.value ?? null,
        occupation: row.occupationLabel?.value ?? null,
      });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/lib/wikidata-presets.ts apps/web/lib/wikidata-query.ts
git commit -m "feat: add wikidata sparql presets and query helper"
```

### Task D2: Query routes

**Files:**
- `apps/web/app/api/admin/wikidata-query/route.ts`
- `apps/web/app/api/admin/wikidata-resolve/route.ts`

- [ ] **Step 1: Query endpoint**

```ts
// apps/web/app/api/admin/wikidata-query/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { PRESETS } from "@/lib/wikidata-presets";
import { runSparql } from "@/lib/wikidata-query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z
  .object({
    preset: z.string().optional(),
    sparql: z.string().max(8000).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .refine((v) => v.preset || v.sparql, { message: "preset or sparql required" });

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad_request", detail: (e as Error).message }, { status: 400 });
  }
  let query: string;
  if (body.preset) {
    const preset = PRESETS.find((p) => p.id === body.preset);
    if (!preset) return NextResponse.json({ error: "unknown_preset" }, { status: 400 });
    query = preset.sparql;
  } else {
    query = body.sparql!;
  }
  try {
    const candidates = await runSparql(query, body.limit);
    return NextResponse.json({ candidates });
  } catch (e) {
    return NextResponse.json({ error: "sparql_failed", detail: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Resolve endpoint (single-QID enrichment)**

```ts
// apps/web/app/api/admin/wikidata-resolve/route.ts
import { NextResponse } from "next/server";

import { runSparql } from "@/lib/wikidata-query";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RESOLVE_QUERY = `
  SELECT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?genderLabel ?occupationLabel WHERE {
    VALUES ?person { wd:{{QID}} }
    OPTIONAL { ?person wdt:P18 ?image. }
    OPTIONAL { ?person wdt:P21 ?gender. }
    OPTIONAL { ?person wdt:P569 ?dob. }
    OPTIONAL { ?person wdt:P570 ?dod. }
    OPTIONAL { ?person wdt:P106 ?occupation. }
    SERVICE wikibase:label {
      bd:serviceParam wikibase:language "en".
      ?person rdfs:label ?personLabel.
      ?gender rdfs:label ?genderLabel.
      ?occupation rdfs:label ?occupationLabel.
    }
    OPTIONAL {
      ?person rdfs:label ?personRuLabel.
      FILTER(LANG(?personRuLabel) = "ru").
    }
  } LIMIT {{LIMIT}}
`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qid = url.searchParams.get("qid");
  if (!qid || !/^Q\d+$/.test(qid)) {
    return NextResponse.json({ error: "bad_qid" }, { status: 400 });
  }
  const rows = await runSparql(RESOLVE_QUERY.replace("{{QID}}", qid), 1);
  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ candidate: rows[0] });
}
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/api/admin/wikidata-query/ apps/web/app/api/admin/wikidata-resolve/
git commit -m "feat: add wikidata-query and wikidata-resolve admin routes"
```

### Task D3: Import wizard — scaffolding + preset picker

**Files:**
- `apps/web/app/admin/layout.tsx` (add nav link)
- `apps/web/app/admin/import/page.tsx`
- `apps/web/app/admin/import/PresetPicker.tsx`
- `apps/web/app/admin/import/types.ts`

- [ ] **Step 1: Add nav link**

In `apps/web/app/admin/layout.tsx`, add `"Import"` alongside existing nav items linking to `/admin/import`.

- [ ] **Step 2: Types**

```ts
// apps/web/app/admin/import/types.ts
import type { RawCandidate } from "@/lib/wikidata-query";

export type CandidateStatus = "queued" | "in_progress" | "done" | "failed";

export type CandidateRecord = {
  raw: RawCandidate;
  selected: boolean;
  status: CandidateStatus;
  error?: string;
  celebrityId?: string;
};

export type ImportStep = "pick" | "review" | "run";
```

- [ ] **Step 3: Page scaffolding**

```tsx
// apps/web/app/admin/import/page.tsx
"use client";

import { useCallback, useState } from "react";

import { PresetPicker } from "./PresetPicker";
import { CandidateReview } from "./CandidateReview";
import { BulkImportOrchestrator } from "./BulkImportOrchestrator";
import type { CandidateRecord, ImportStep } from "./types";
import type { RawCandidate } from "@/lib/wikidata-query";

export default function ImportPage() {
  const [step, setStep] = useState<ImportStep>("pick");
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);

  const onQueryResult = useCallback((rows: RawCandidate[]) => {
    setCandidates(
      rows.map((raw) => ({ raw, selected: true, status: "queued" })),
    );
    setStep("review");
  }, []);

  const onStartRun = useCallback((selected: CandidateRecord[]) => {
    setCandidates(selected);
    setStep("run");
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Bulk import from Wikidata</h1>
      <Stepper current={step} />
      {step === "pick" && <PresetPicker onResults={onQueryResult} />}
      {step === "review" && (
        <CandidateReview
          candidates={candidates}
          onBack={() => setStep("pick")}
          onStart={onStartRun}
        />
      )}
      {step === "run" && <BulkImportOrchestrator initial={candidates} />}
    </div>
  );
}

function Stepper({ current }: { current: ImportStep }) {
  const steps: Array<{ id: ImportStep; label: string }> = [
    { id: "pick", label: "1. Pick preset" },
    { id: "review", label: "2. Review" },
    { id: "run", label: "3. Run" },
  ];
  return (
    <ol className="flex items-center gap-2 text-sm text-neutral-500">
      {steps.map((s, i) => (
        <li key={s.id} className={current === s.id ? "font-semibold text-neutral-900" : ""}>
          {s.label}
          {i < steps.length - 1 && <span className="px-2 text-neutral-300">→</span>}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Preset picker**

```tsx
// apps/web/app/admin/import/PresetPicker.tsx
"use client";

import { useState } from "react";

import { PRESETS } from "@/lib/wikidata-presets";
import type { RawCandidate } from "@/lib/wikidata-query";

export function PresetPicker({ onResults }: { onResults: (rows: RawCandidate[]) => void }) {
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [customSparql, setCustomSparql] = useState("");
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [limit, setLimit] = useState(50);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setRunning(true);
    setError(null);
    try {
      const body = mode === "preset" ? { preset: presetId, limit } : { sparql: customSparql, limit };
      const res = await fetch("/api/admin/wikidata-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { candidates?: RawCandidate[]; error?: string; detail?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onResults(data.candidates ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="inline-flex rounded-lg border border-neutral-300 bg-white p-1 text-sm">
        {(["preset", "custom"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "rounded-md px-3 py-1 font-medium transition-colors " +
              (mode === m ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900")
            }
          >
            {m === "preset" ? "Preset" : "Custom SPARQL"}
          </button>
        ))}
      </div>

      {mode === "preset" && (
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      )}
      {mode === "custom" && (
        <textarea
          value={customSparql}
          onChange={(e) => setCustomSparql(e.target.value)}
          rows={8}
          placeholder="SELECT ..."
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs"
        />
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Limit</span>
        <input
          type="number"
          min={1}
          max={500}
          value={limit}
          onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value))))}
          className="w-32 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}

      <button
        onClick={() => void submit()}
        disabled={running || (mode === "custom" && customSparql.trim().length === 0)}
        className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? "Running…" : "Run query"}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/admin/layout.tsx apps/web/app/admin/import/
git commit -m "feat: scaffold bulk import wizard with preset picker"
```

### Task D4: Candidate review

**Files:** `apps/web/app/admin/import/CandidateReview.tsx`

- [ ] **Step 1: Implement review UI**

~150 lines. Table with checkbox (default checked), name, nameRu, dates, occupation, thumbnail (use `/api/admin/fetch-image?url=https://commons.wikimedia.org/wiki/Special:FilePath/<file>?width=128`). "Select all / none" toggles. "Back" / "Start import" buttons. On start: hand the selected list (copy of records with `selected: true`) to `onStart`.

Include a warning: "Will write directly to prod. N celebrities, ~N×3s for embeds + N for descriptions."

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/admin/import/CandidateReview.tsx
git commit -m "feat: candidate review step for bulk import"
```

### Task D5: Orchestrator — per-celeb pipeline

**Files:**
- `apps/web/app/admin/import/BulkImportOrchestrator.tsx`
- `apps/web/app/admin/import/storage.ts`

- [ ] **Step 1: Storage helpers**

```ts
// apps/web/app/admin/import/storage.ts
import type { CandidateRecord } from "./types";

const KEY = "starface_bulk_import_v1";

export type PersistedState = {
  createdAt: number;
  candidates: CandidateRecord[];
};

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or disabled; ignore
  }
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // noop
  }
}
```

- [ ] **Step 2: Orchestrator component**

The orchestrator's responsibilities:

1. On mount, persist initial state to localStorage.
2. Process queued celebrities with parallelism 3.
3. For each:
   a. `GET /api/admin/wikidata-resolve?qid=<qid>` — enrich (gender, P18 file)
   b. If image file present: `GET /api/admin/fetch-image?url=https://commons.wikimedia.org/wiki/Special:FilePath/<file>` → `Blob` → `createImageBitmap` → `detectAndEmbed` → single-celeb `/api/admin/enroll` payload (with `externalId: qid`, `name`, `nameRu`, `gender`, `category` (from selection), photo array).
   c. If image missing or embed fails: `POST /api/admin/enroll` with no photos? — existing enroll route requires `photos.min(1)`. So in that case we skip the celeb and mark `failed: "no_p18_image"`. Operator adds photos later via Phase C.
   d. After successful enroll (returns `inserted: 1` or `updated: 1`; we need the celebrity id — enrich enroll response to return ids; see sub-step below).
   e. `POST /api/admin/celebrities/:id/generate-description` to fill UZ/RU/EN.
4. Persist state every 5 completions.
5. On completion or pause, render summary (N done, N failed, per-celeb details with links).
6. On mount: call `loadState()`; if present and has queued items, offer "Resume" / "Discard and start fresh".

~350 lines total. Key snippet:

```tsx
const CONCURRENCY = 3;

async function processOne(rec: CandidateRecord, category: "uz" | "cis" | "world"): Promise<CandidateRecord> {
  try {
    // enrich
    const resEnrich = await fetch(`/api/admin/wikidata-resolve?qid=${rec.raw.qid}`);
    if (!resEnrich.ok) throw new Error(`resolve_${resEnrich.status}`);
    const { candidate } = (await resEnrich.json()) as { candidate: typeof rec.raw & { genderLabel?: string } };

    if (!candidate.imageFile) {
      return { ...rec, status: "failed", error: "no_p18_image" };
    }

    // fetch image
    const imgUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(candidate.imageFile)}`;
    const imgRes = await fetch(`/api/admin/fetch-image?url=${encodeURIComponent(imgUrl)}`);
    if (!imgRes.ok) throw new Error(`image_${imgRes.status}`);
    const blob = await imgRes.blob();
    const bitmap = await createImageBitmap(blob);

    // embed
    const embed = await detectAndEmbed(bitmap);
    bitmap.close();

    // enroll
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
    const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
    const gender = mapGender(candidate.genderLabel); // "male" -> "M", "female" -> "F", else null
    const age = ageFromDob(candidate.dob); // returns number | null

    const enrollRes = await fetch("/api/admin/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        celebrities: [
          {
            externalId: candidate.qid,
            name: candidate.name,
            nameRu: candidate.nameRu,
            category,
            gender,
            age,
            photos: [
              {
                imageBase64: base64,
                imageExt: ext,
                embedding: embed.embedding,
                detScore: embed.detScore,
                faceQuality: embed.faceQuality,
                isPrimary: true,
                source: "wikidata",
                sourceUrl: `https://www.wikidata.org/wiki/${candidate.qid}`,
              },
            ],
          },
        ],
      }),
    });
    if (!enrollRes.ok) throw new Error(`enroll_${enrollRes.status}`);

    // NOTE: existing /api/admin/enroll route currently doesn't return
    // celebrity ids in the response. See Step D6 for the patch to add
    // `insertedIds` / `updatedIds` to the response so we can chain
    // description generation.

    // description
    // ... see Step D7 ...

    return { ...rec, status: "done" };
  } catch (e) {
    return { ...rec, status: "failed", error: (e as Error).message };
  }
}
```

- [ ] **Step 3: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/admin/import/
git commit -m "feat: bulk import orchestrator with parallelism and persistence"
```

### Task D6: Return celebrity ids from `/api/admin/enroll`

**Files:** `apps/web/app/api/admin/enroll/route.ts`

The existing enroll route returns `{ inserted, updated, failed }` but not which ids. The orchestrator needs the id to call `/generate-description` next.

- [ ] **Step 1: Extend `EnrollResult` type and response**

In [apps/web/app/api/admin/enroll/route.ts](../../apps/web/app/api/admin/enroll/route.ts):

```ts
type EnrollResult = {
  inserted: number;
  updated: number;
  failed: Array<{ externalId: string | null; name: string; reason: string }>;
  ids: Array<{ externalId: string | null; celebrityId: string; action: "inserted" | "updated" }>;
};
```

Populate `ids` inside the existing per-celeb loop. Return it in the final `NextResponse.json(result)`.

- [ ] **Step 2: Typecheck + lint + commit**

```bash
pnpm --filter @starface/web typecheck
pnpm --filter @starface/web lint
git add apps/web/app/api/admin/enroll/route.ts
git commit -m "feat: return celebrity ids from enroll route"
```

### Task D7: Wire description generation into orchestrator

**Files:** `apps/web/app/admin/import/BulkImportOrchestrator.tsx`

- [ ] **Step 1: Call generate-description per imported celeb**

In the orchestrator's `processOne`, after enroll succeeds, read `enrollData.ids[0].celebrityId` and call:

```ts
await fetch(`/api/admin/celebrities/${celebrityId}/generate-description`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
```

Failure of description generation does NOT fail the whole celeb — the operator can regenerate later. Log to orchestrator state as `done_no_description` status.

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/app/admin/import/BulkImportOrchestrator.tsx
git commit -m "feat: chain description generation after bulk enroll"
```

### Task D8: Retry-failed + summary

**Files:** `apps/web/app/admin/import/BulkImportOrchestrator.tsx`

- [ ] **Step 1: After the queue drains, show a summary table**

Columns: name, qid, status (done/failed), error (if any), link to `/admin/celebrities/<id>` (if done). "Retry failed" button re-queues only the failed ones (resets their status to `queued`, restarts loop).

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @starface/web typecheck
git add apps/web/app/admin/import/BulkImportOrchestrator.tsx
git commit -m "feat: bulk import summary with retry-failed"
```

### Task D9: Smoke

Against prod bindings (and with GEMINI_API_KEY live since this uses Phase B):

1. Open `/admin/import`.
2. Preset "Uzbek actors", limit 5. Run query. Review table populates.
3. Deselect 1 celeb. Click Start. Orchestrator runs. Progress visible.
4. Refresh the tab mid-run. Page should detect persisted state and offer Resume. Resume — remaining celebs finish.
5. Spot-check: `/admin/celebrities?q=<name>` shows new rows with photos + descriptions.
6. Kill network mid-run (devtools offline). Some fail. Click "Retry failed" after going back online — they finish.

No commit — smoke only.

### Task D10: Deprecate `scripts/seed/*`

**Files:**
- `scripts/README.md`
- `scripts/package.json`

- [ ] **Step 1: Mark deprecated**

In `scripts/README.md`, add a header:

```
> **DEPRECATED (2026-04):** The online admin UI at `/admin/import` replaces
> this CLI pipeline. Keep this folder for offline operations during a Commons
> or Wikidata outage. No new features land here.
```

- [ ] **Step 2: Commit**

```bash
git add scripts/README.md
git commit -m "docs: mark scripts/seed as deprecated in favour of admin import"
```

Actual deletion of `scripts/` happens in a separate change after the online flow has been proven in real ops (at least ~1 month of successful imports).

### Phase D coverage check

- SPARQL presets + runner → D1
- Worker routes for query / resolve → D2
- Wizard UI → D3, D4
- Orchestrator → D5, D7, D8
- Enroll-route patch → D6
- Smoke → D9
- scripts/ deprecation notice → D10

---

## Cross-phase deployment sequence

Recommended shipping order:

1. **Phase B** end-to-end (B1–B9). Smallest, unblocks description UX immediately.
2. **Phase A.1** (WebGPU) — shipped any time, trivial commit.
3. **Phase A.2, A.3** — copy fix + pagination. Ship before the dataset grows past a few hundred.
4. **Phase A.4, A.5** — file split + dedicated page. Nice-to-have before starting Phase C.
5. **Phase C** — needs the dedicated page in A.5 only for UX polish; otherwise can ship after A.1–A.3.
6. **Phase D** — after B and C are stable in prod.

Secrets to set in prod, in order:
- `GEMINI_API_KEY` — for Phase B (and D, which depends on B)

Nothing else new; all other secrets remain unchanged.

---

## Master coverage check

Mapping original user asks → phases:

| Ask | Phase / Tasks |
|---|---|
| Смотреть знаменитостей | Existing CRUD + A.5 dedicated page |
| Редактировать знаменитостей | Existing EditMode + A.4 split |
| Добавлять фото | Existing PhotoGallery + A.1 WebGPU speedup |
| Генерировать и перегенерировать описания | Phase B end-to-end |
| Массовый импорт из Википедии | Phase D end-to-end |
| Автопоиск качественных фото | Phase C end-to-end |
| Стабильная синхронизация с продом | Global decision 2 (direct write) + dedicated URLs in A.5 |
| Работа полностью онлайн | Global decisions 1 + 5; embeds in browser (existing pipeline) |
| Gemini 3.1 Flash Lite | Phase B, B1 + B5 |
| WebGPU | Phase A, A1 |

Nothing in the original ask is left unmapped.

import { and, count, desc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import Link from "next/link";

import { db, schema } from "@/lib/db";
import { CelebritiesList, type CelebrityRow } from "./CelebritiesList";
import { CelebritiesFilters } from "./CelebritiesFilters";

export const dynamic = "force-dynamic";

const DEFAULT_SIZE = 60;
const MAX_SIZE = 200;
const CATEGORIES = ["uz", "cis", "world"] as const;
type Category = (typeof CATEGORIES)[number];

type SearchParams = Promise<{
  q?: string;
  cat?: string;
  page?: string;
  size?: string;
}>;

function buildQuery(params: {
  q: string;
  cat: Category | null;
  page: number;
  size: number;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.cat) sp.set("cat", params.cat);
  if (params.page !== 1) sp.set("page", String(params.page));
  if (params.size !== DEFAULT_SIZE) sp.set("size", String(params.size));
  return sp.toString();
}

export default async function CelebritiesListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const catRaw = sp.cat ?? "";
  const cat: Category | null = CATEGORIES.includes(catRaw as Category)
    ? (catRaw as Category)
    : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = Math.min(MAX_SIZE, Math.max(1, Number(sp.size ?? DEFAULT_SIZE) || DEFAULT_SIZE));
  const offset = (page - 1) * size;

  const conditions: SQL[] = [];
  if (cat) conditions.push(eq(schema.celebrities.category, cat));
  if (q) {
    const pattern = `%${q}%`;
    const orClause = or(
      like(schema.celebrities.name, pattern),
      like(schema.celebrities.nameRu, pattern),
      like(schema.celebrities.descriptionUz, pattern),
      like(schema.celebrities.descriptionRu, pattern),
      like(schema.celebrities.descriptionEn, pattern),
    );
    if (orClause) conditions.push(orClause);
  }
  const filters = conditions.length ? and(...conditions) : undefined;

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
        .where(inArray(schema.celebrityPhotos.celebrityId, celebIds))
    : [];

  const photosByCeleb = new Map<string, typeof photos>();
  for (const p of photos) {
    const list = photosByCeleb.get(p.celebrityId) ?? [];
    list.push(p);
    photosByCeleb.set(p.celebrityId, list);
  }
  for (const list of photosByCeleb.values()) {
    list.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aT - bT;
    });
  }

  const celebrities: CelebrityRow[] = celebs.map((c) => {
    const ps = photosByCeleb.get(c.id) ?? [];
    const primary = ps.find((p) => p.isPrimary) ?? ps[0] ?? null;
    return {
      id: c.id,
      name: c.name,
      nameRu: c.nameRu,
      category: c.category,
      descriptionUz: c.descriptionUz,
      descriptionRu: c.descriptionRu,
      descriptionEn: c.descriptionEn,
      wikidataId: c.wikidataId,
      active: c.active,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      photos: ps.map((p) => ({
        id: p.id,
        photoPath: p.photoPath,
        isPrimary: p.isPrimary,
        faceQuality: p.faceQuality,
      })),
      primaryPhotoPath: primary?.photoPath ?? null,
      photoCount: ps.length,
    };
  });

  const totalPages = Math.max(1, Math.ceil(total.c / size));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Celebrities ({total.c})</h1>
        <Link
          href="/admin/celebrities/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
        >
          + Enroll celebrity
        </Link>
      </div>
      <CelebritiesFilters q={q} cat={cat} categories={CATEGORIES} />
      <CelebritiesList celebrities={celebrities} />
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
          Page {page} / {totalPages}
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
    </div>
  );
}

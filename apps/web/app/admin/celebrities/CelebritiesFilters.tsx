"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

type Category = "uz" | "cis" | "world";

export function CelebritiesFilters({
  q,
  cat,
  categories,
}: {
  q: string;
  cat: Category | null;
  categories: readonly Category[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(q);

  function navigate(next: { q?: string; cat?: Category | null }) {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    sp.delete("page");
    const nq = next.q ?? query;
    const nc = next.cat === undefined ? cat : next.cat;
    if (nq) sp.set("q", nq);
    else sp.delete("q");
    if (nc) sp.set("cat", nc);
    else sp.delete("cat");
    const qs = sp.toString();
    router.push(`/admin/celebrities${qs ? `?${qs}` : ""}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    navigate({ q: query });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={onSubmit} className="flex flex-1 gap-2 min-w-[260px]">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or description..."
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold"
        >
          Search
        </button>
      </form>
      <div className="inline-flex rounded-lg border border-neutral-300 bg-white p-1 text-sm">
        <button
          type="button"
          onClick={() => navigate({ cat: null })}
          className={
            "rounded-md px-3 py-1 font-medium capitalize transition-colors " +
            (cat === null
              ? "bg-neutral-900 text-white"
              : "text-neutral-600 hover:text-neutral-900")
          }
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => navigate({ cat: c })}
            className={
              "rounded-md px-3 py-1 font-medium capitalize transition-colors " +
              (cat === c
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:text-neutral-900")
            }
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

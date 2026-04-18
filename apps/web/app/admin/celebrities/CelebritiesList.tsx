"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CelebrityCard } from "./CelebrityCard";
import { CelebrityModal } from "./CelebrityModal";
import type { CelebrityRow } from "./types";

export type { CelebrityPhotoMini, CelebrityRow } from "./types";

export function CelebritiesList({ celebrities }: { celebrities: CelebrityRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<CelebrityRow | null>(null);

  return (
    <div className="space-y-4">
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
    </div>
  );
}

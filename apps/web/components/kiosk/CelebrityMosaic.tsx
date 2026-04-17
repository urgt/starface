"use client";

import { useEffect, useState } from "react";

type Item = { id: string; name: string; photoUrl: string };

type Props = {
  columns?: number;
  maxItems?: number;
};

export function CelebrityMosaic({ columns = 6, maxItems = 24 }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/celebrities/preview")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { items: Item[] }) => {
        if (cancelled) return;
        setItems((data.items ?? []).slice(0, maxItems));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [maxItems]);

  if (!loaded || items.length === 0) {
    return <MosaicFallback columns={columns} />;
  }

  // Duplicate items so the CSS mosaicScroll animation loops seamlessly (translateY -50%)
  const loop = [...items, ...items];

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="grid h-[200%] w-full gap-3 p-3 animate-mosaic-scroll will-change-transform"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {loop.map((item, i) => (
          <MosaicTile key={`${item.id}-${i}`} item={item} index={i} />
        ))}
      </div>
    </div>
  );
}

function MosaicTile({ item, index }: { item: Item; index: number }) {
  const offset = (index % 5) * 80;
  return (
    <div
      className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-white/5 shadow-xl ring-1 ring-white/5"
      style={{ animation: `floatIn 700ms ${offset}ms cubic-bezier(0.16, 1, 0.3, 1) both` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.photoUrl}
        alt={item.name}
        loading="lazy"
        className="h-full w-full object-cover opacity-90 transition duration-700 hover:scale-105 hover:opacity-100"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-3 pb-2 text-xs font-medium text-white/80">
        {item.name}
      </div>
    </div>
  );
}

function MosaicFallback({ columns }: { columns: number }) {
  const tiles = Array.from({ length: columns * 4 });
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="grid h-full w-full gap-3 p-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {tiles.map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] rounded-2xl bg-gradient-to-br from-white/5 to-white/[0.02] ring-1 ring-white/5"
            style={{
              animation: `glowPulse ${3 + (i % 5) * 0.4}s ease-in-out ${(i % 7) * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

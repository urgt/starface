"use client";

import { useEffect, useRef, useState } from "react";

type Item = { id: string; name: string; photoUrl: string };

type Props = {
  columns?: number;
  maxItems?: number;
};

export function CelebrityMosaic({ columns = 4, maxItems = 12 }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/celebrities/preview")
      .then((r) => (r.ok ? (r.json() as Promise<{ items: Item[] }>) : Promise.reject(r.status)))
      .then((data) => {
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

  // Pause the infinite scroll animation when the tab/kiosk is backgrounded —
  // saves GPU cycles on TVs that don't do it automatically.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = scrollerRef.current;
    if (!el) return;
    const apply = () => {
      el.style.animationPlayState = document.visibilityState === "hidden" ? "paused" : "running";
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => document.removeEventListener("visibilitychange", apply);
  }, [loaded]);

  if (!loaded || items.length === 0) {
    return <MosaicFallback columns={columns} />;
  }

  // Duplicate items so the CSS mosaicScroll animation loops seamlessly (translateY -50%)
  const loop = [...items, ...items];

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        ref={scrollerRef}
        className="grid h-[200%] w-full gap-2 p-2 animate-mosaic-scroll tv:gap-3 tv:p-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {loop.map((item, i) => (
          <MosaicTile key={`${item.id}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function MosaicTile({ item }: { item: Item }) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.photoUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover opacity-90"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
    </div>
  );
}

function MosaicFallback({ columns }: { columns: number }) {
  const tiles = Array.from({ length: columns * 3 });
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="grid h-full w-full gap-2 p-2 tv:gap-3 tv:p-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {tiles.map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] rounded-2xl bg-white/5 ring-1 ring-white/5"
          />
        ))}
      </div>
    </div>
  );
}

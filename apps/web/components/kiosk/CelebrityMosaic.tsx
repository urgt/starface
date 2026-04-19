"use client";

import { useEffect, useRef, useState } from "react";

type Item = { id: string; name: string; photoUrl: string };

type Props = {
  maxItems?: number;
  /** Overrides the auto-fit layout. Used only by the fallback skeleton. */
  columns?: number;
};

export function CelebrityMosaic({ maxItems = 12, columns }: Props) {
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

  const gridTemplate = columns
    ? `repeat(${columns}, minmax(0, 1fr))`
    : "repeat(auto-fit, minmax(clamp(140px, 16vw, 280px), 1fr))";

  if (!loaded || items.length === 0) {
    return <MosaicFallback gridTemplate={gridTemplate} />;
  }

  // Duplicate items so the CSS mosaicScroll animation loops seamlessly (translateY -50%)
  const loop = [...items, ...items];

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        ref={scrollerRef}
        className="grid h-[200%] w-full animate-mosaic-scroll"
        style={{
          gridTemplateColumns: gridTemplate,
          gap: "var(--kiosk-gap)",
          padding: "calc(var(--kiosk-gap) * 0.5)",
        }}
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
    <div
      className="relative aspect-[4/5] overflow-hidden bg-white/5 ring-1 ring-white/5"
      style={{ borderRadius: "var(--kiosk-radius)" }}
    >
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

function MosaicFallback({ gridTemplate }: { gridTemplate: string }) {
  const tiles = Array.from({ length: 18 });
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: gridTemplate,
          gap: "var(--kiosk-gap)",
          padding: "calc(var(--kiosk-gap) * 0.5)",
        }}
      >
        {tiles.map((_, i) => (
          <div
            key={i}
            className="aspect-[4/5] bg-white/5 ring-1 ring-white/5"
            style={{ borderRadius: "var(--kiosk-radius)" }}
          />
        ))}
      </div>
    </div>
  );
}

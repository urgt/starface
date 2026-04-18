"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { EditMode } from "../EditMode";
import type { CelebrityDetail } from "../types";
import { ViewMode } from "../ViewMode";

export function CelebrityPage({ initial }: { initial: CelebrityDetail }) {
  const router = useRouter();
  const [detail, setDetail] = useState<CelebrityDetail>(initial);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/celebrities/${initial.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as CelebrityDetail;
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [initial.id]);

  const onDeleted = useCallback(() => {
    router.push("/admin/celebrities");
  }, [router]);

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {mode === "view" ? (
        <ViewMode
          detail={detail}
          onEdit={() => setMode("edit")}
          onRefresh={load}
          onDeleted={onDeleted}
        />
      ) : (
        <EditMode
          detail={detail}
          onCancel={() => setMode("view")}
          onSaved={async () => {
            await load();
            setMode("view");
          }}
          onRefresh={load}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

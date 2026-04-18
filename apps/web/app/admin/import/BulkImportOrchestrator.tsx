"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { detectAndEmbed, FaceEmbedError } from "@/lib/face-embed";
import type { RawCandidate } from "@/lib/wikidata-query";
import { readFileAsBase64 } from "../celebrities/upload-helpers";
import { clearState, saveState } from "./storage";
import type { CandidateRecord, ImportCategory } from "./types";

const CONCURRENCY = 3;
const PERSIST_EVERY = 5;

function mapGender(label: string | null | undefined): "M" | "F" | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes("male") && !l.includes("female")) return "M";
  if (l.includes("female")) return "F";
  return null;
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const m = /^(-?\d{1,4})/.exec(dob);
  if (!m) return null;
  const year = Number(m[1]);
  if (!Number.isFinite(year)) return null;
  const now = new Date().getFullYear();
  const age = now - year;
  if (age < 0 || age > 150) return null;
  return age;
}

function extFromContentType(ct: string): "jpg" | "jpeg" | "png" | "webp" {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg")) return "jpeg";
  return "jpg";
}

type EnrollResponse = {
  inserted: number;
  updated: number;
  failed: Array<{ externalId: string | null; name: string; reason: string }>;
  ids: Array<{
    externalId: string | null;
    name: string;
    celebrityId: string;
    action: "inserted" | "updated";
  }>;
};

async function processOne(
  rec: CandidateRecord,
  category: ImportCategory,
): Promise<Partial<CandidateRecord>> {
  try {
    const enrichRes = await fetch(
      `/api/admin/wikidata-resolve?qid=${encodeURIComponent(rec.raw.qid)}`,
    );
    if (!enrichRes.ok) throw new Error(`resolve_${enrichRes.status}`);
    const { candidate } = (await enrichRes.json()) as { candidate: RawCandidate };

    if (!candidate.imageFile) {
      return { status: "failed", error: "no_p18_image" };
    }

    const imgUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
      candidate.imageFile,
    )}`;
    const imgRes = await fetch(
      `/api/admin/fetch-image?url=${encodeURIComponent(imgUrl)}`,
    );
    if (!imgRes.ok) throw new Error(`image_${imgRes.status}`);
    const blob = await imgRes.blob();

    const bitmap = await createImageBitmap(blob);
    let embed;
    try {
      embed = await detectAndEmbed(bitmap);
    } finally {
      bitmap.close();
    }
    const file = new File([blob], candidate.imageFile, { type: blob.type });
    const base64 = await readFileAsBase64(file);
    const ext = extFromContentType(blob.type);

    const gender = mapGender(candidate.genderLabel);
    const age = ageFromDob(candidate.dob);

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
            popularity: 0,
            attrsSource: "wikidata",
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
    const enrollData = (await enrollRes.json()) as EnrollResponse;
    const celebrityId = enrollData.ids[0]?.celebrityId;
    if (!celebrityId) {
      const failureReason = enrollData.failed[0]?.reason ?? "enroll_no_id";
      throw new Error(failureReason);
    }

    const descRes = await fetch(
      `/api/admin/celebrities/${celebrityId}/generate-description`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    if (!descRes.ok) {
      return { status: "done_no_description", celebrityId };
    }

    return { status: "done", celebrityId };
  } catch (e) {
    const code = e instanceof FaceEmbedError ? e.code : (e as Error).message;
    return { status: "failed", error: code };
  }
}

export function BulkImportOrchestrator({
  initial,
  category,
  onReset,
}: {
  initial: CandidateRecord[];
  category: ImportCategory;
  onReset: () => void;
}) {
  const [records, setRecords] = useState<CandidateRecord[]>(initial);
  const [running, setRunning] = useState(false);
  const completedSinceSave = useRef(0);
  const runToken = useRef(0);

  useEffect(() => {
    saveState({ createdAt: Date.now(), category, candidates: records });
  }, [category, records]);

  const updateRecord = useCallback(
    (qid: string, patch: Partial<CandidateRecord>) => {
      setRecords((prev) =>
        prev.map((r) => (r.raw.qid === qid ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const run = useCallback(
    async (queueSubset: string[]) => {
      const myToken = ++runToken.current;
      setRunning(true);
      completedSinceSave.current = 0;

      const queue = [...queueSubset];
      async function worker() {
        while (queue.length > 0) {
          if (myToken !== runToken.current) return;
          const qid = queue.shift();
          if (!qid) return;
          updateRecord(qid, { status: "in_progress", error: undefined });
          const current = records.find((r) => r.raw.qid === qid);
          if (!current) continue;
          const patch = await processOne(current, category);
          if (myToken !== runToken.current) return;
          updateRecord(qid, patch);
          completedSinceSave.current += 1;
          if (completedSinceSave.current >= PERSIST_EVERY) {
            completedSinceSave.current = 0;
            setRecords((prev) => {
              saveState({ createdAt: Date.now(), category, candidates: prev });
              return prev;
            });
          }
        }
      }
      const workers = Array.from({ length: Math.min(CONCURRENCY, queueSubset.length) }, () =>
        worker(),
      );
      await Promise.all(workers);
      if (myToken === runToken.current) setRunning(false);
    },
    [category, records, updateRecord],
  );

  useEffect(() => {
    const initialQueue = initial.filter((r) => r.status === "queued").map((r) => r.raw.qid);
    if (initialQueue.length === 0) return;
    void run(initialQueue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    let done = 0;
    let doneNoDesc = 0;
    let failed = 0;
    let queued = 0;
    let inProgress = 0;
    for (const r of records) {
      if (r.status === "done") done++;
      else if (r.status === "done_no_description") doneNoDesc++;
      else if (r.status === "failed") failed++;
      else if (r.status === "queued") queued++;
      else if (r.status === "in_progress") inProgress++;
    }
    return { done, doneNoDesc, failed, queued, inProgress, total: records.length };
  }, [records]);

  function retryFailed() {
    const failedQids = records.filter((r) => r.status === "failed").map((r) => r.raw.qid);
    if (failedQids.length === 0) return;
    setRecords((prev) =>
      prev.map((r) =>
        r.status === "failed" ? { ...r, status: "queued", error: undefined } : r,
      ),
    );
    void run(failedQids);
  }

  function finishAndReset() {
    runToken.current += 1;
    clearState();
    onReset();
  }

  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <strong className="text-lg font-bold">
            {stats.done + stats.doneNoDesc}/{stats.total} done
          </strong>
          <span className="ml-3 text-neutral-500">
            {stats.inProgress} in progress · {stats.queued} queued · {stats.failed} failed
          </span>
        </div>
        <div className="flex gap-2">
          {stats.failed > 0 && !running && (
            <button
              onClick={retryFailed}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold"
            >
              Retry failed ({stats.failed})
            </button>
          )}
          <button
            onClick={finishAndReset}
            disabled={running}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50"
          >
            {running ? "Running…" : "Finish"}
          </button>
        </div>
      </header>

      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">QID</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.raw.qid} className="border-t border-neutral-100">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.raw.name}</div>
                  {r.raw.nameRu && (
                    <div className="text-xs text-neutral-500">{r.raw.nameRu}</div>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.raw.qid}</td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {r.status === "failed" && r.error}
                  {(r.status === "done" || r.status === "done_no_description") &&
                    r.celebrityId && (
                      <Link
                        href={`/admin/celebrities/${r.celebrityId}`}
                        className="text-blue-600 hover:underline"
                      >
                        Open
                      </Link>
                    )}
                  {r.status === "done_no_description" && (
                    <span className="ml-2 text-amber-600">description missing</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: CandidateRecord["status"] }) {
  const base = "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider";
  switch (status) {
    case "queued":
      return <span className={`${base} bg-neutral-200 text-neutral-700`}>queued</span>;
    case "in_progress":
      return <span className={`${base} bg-blue-100 text-blue-700`}>running</span>;
    case "done":
      return <span className={`${base} bg-green-100 text-green-700`}>done</span>;
    case "done_no_description":
      return (
        <span className={`${base} bg-yellow-100 text-yellow-700`}>done (no desc)</span>
      );
    case "failed":
      return <span className={`${base} bg-red-100 text-red-700`}>failed</span>;
  }
}

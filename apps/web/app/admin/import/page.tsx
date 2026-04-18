"use client";

import { useCallback, useEffect, useState } from "react";

import type { RawCandidate } from "@/lib/wikidata-query";
import { BulkImportOrchestrator } from "./BulkImportOrchestrator";
import { CandidateReview } from "./CandidateReview";
import { PresetPicker } from "./PresetPicker";
import { clearState, loadState } from "./storage";
import type { CandidateRecord, ImportCategory, ImportStep } from "./types";

export default function ImportPage() {
  const [step, setStep] = useState<ImportStep>("pick");
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [category, setCategory] = useState<ImportCategory>("uz");
  const [resumeAvailable, setResumeAvailable] = useState(false);

  useEffect(() => {
    const persisted = loadState();
    if (persisted && persisted.candidates.some((c) => c.status === "queued" || c.status === "in_progress")) {
      setResumeAvailable(true);
    }
  }, []);

  const onQueryResult = useCallback((rows: RawCandidate[], cat: ImportCategory) => {
    setCandidates(
      rows.map((raw) => ({ raw, selected: true, status: "queued" as const })),
    );
    setCategory(cat);
    setStep("review");
  }, []);

  const onStartRun = useCallback((selected: CandidateRecord[]) => {
    setCandidates(selected);
    setStep("run");
  }, []);

  const onResume = useCallback(() => {
    const persisted = loadState();
    if (!persisted) return;
    setCandidates(persisted.candidates);
    setCategory(persisted.category);
    setResumeAvailable(false);
    setStep("run");
  }, []);

  const onDiscardResume = useCallback(() => {
    clearState();
    setResumeAvailable(false);
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Bulk import from Wikidata</h1>
      <Stepper current={step} />

      {resumeAvailable && step === "pick" && (
        <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          <span>An unfinished import is saved locally.</span>
          <div className="flex gap-2">
            <button
              onClick={onResume}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Resume
            </button>
            <button
              onClick={onDiscardResume}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {step === "pick" && <PresetPicker onResults={onQueryResult} />}
      {step === "review" && (
        <CandidateReview
          candidates={candidates}
          category={category}
          onBack={() => setStep("pick")}
          onStart={onStartRun}
        />
      )}
      {step === "run" && (
        <BulkImportOrchestrator
          initial={candidates}
          category={category}
          onReset={() => {
            clearState();
            setCandidates([]);
            setStep("pick");
          }}
        />
      )}
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

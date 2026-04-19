import type { RawCandidate } from "@/lib/wikidata-query";

export type CandidateStatus =
  | "queued"
  | "in_progress"
  | "done"
  | "done_no_description"
  | "failed";

export type CandidateRecord = {
  raw: RawCandidate;
  selected: boolean;
  status: CandidateStatus;
  error?: string;
  celebrityId?: string;
};

export type ImportStep = "pick" | "review" | "run";

export type ImportCategory = "uz" | "cis" | "world";

export type QueryMeta = {
  requested: number;
  fetchedTotal: number;
  skippedExisting: number;
};

import type { CandidateRecord, ImportCategory } from "./types";

const KEY = "starface_bulk_import_v1";

export type PersistedState = {
  createdAt: number;
  category: ImportCategory;
  candidates: CandidateRecord[];
};

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota exceeded or disabled; ignore
  }
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // noop
  }
}

import path from "node:path";

export const appConfig = {
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  userPhotoTtlHours: Number(process.env.USER_PHOTO_TTL_HOURS ?? 24),
  matchMinCosine: Number(process.env.MATCH_MIN_COSINE ?? 0.2),
  displayMinPct: Number(process.env.DISPLAY_MIN_PCT ?? 60),
  displayMaxPct: Number(process.env.DISPLAY_MAX_PCT ?? 97),
  // Match re-rank tuning. See /api/match route for the scoring formula.
  // K: how many nearest-neighbour photos to pull before dedupe + re-rank.
  matchRerankK: Number(process.env.MATCH_RERANK_K ?? 60),
  // λ applied to raw cosine when the user's detected sex disagrees with the
  // celebrity's stored gender. Soft penalty — never an absolute filter.
  matchGenderPenalty: Number(process.env.MATCH_GENDER_PENALTY ?? 0.1),
  // λ applied per year of |Δage|, normalised to a 30-year span and capped.
  matchAgePenalty: Number(process.env.MATCH_AGE_PENALTY ?? 0.05),
  // If the best cross-gender candidate beats the best same-gender one by less
  // than this much cosine, always prefer the same-gender one.
  matchTiebreakDelta: Number(process.env.MATCH_TIEBREAK_DELTA ?? 0.03),
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  adminUser: process.env.ADMIN_USER ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "change-me",
};

export function mapCosineToPct(cosine: number): number {
  const { displayMinPct, displayMaxPct, matchMinCosine } = appConfig;
  const clamped = Math.max(matchMinCosine, Math.min(1, cosine));
  const t = (clamped - matchMinCosine) / (1 - matchMinCosine);
  const pct = displayMinPct + t * (displayMaxPct - displayMinPct);
  return Math.round(pct);
}

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const EMBEDDING_DIM = 1024;

export const appConfig = {
  userPhotoTtlHours: num(process.env.USER_PHOTO_TTL_HOURS, 24),
  matchMinCosine: num(process.env.MATCH_MIN_COSINE, 0.2),
  displayMinPct: num(process.env.DISPLAY_MIN_PCT, 60),
  displayMaxPct: num(process.env.DISPLAY_MAX_PCT, 97),
  matchRerankK: num(process.env.MATCH_RERANK_K, 60),
  matchWCos: num(process.env.MATCH_W_COS, 1.0),
  matchGenderPenalty: num(process.env.MATCH_GENDER_PENALTY, 0.1),
  matchAgePenalty: num(process.env.MATCH_AGE_PENALTY, 0.05),
  matchTiebreakDelta: num(process.env.MATCH_TIEBREAK_DELTA, 0.03),
  matchQualityPenalty: num(process.env.MATCH_QUALITY_PENALTY, 0.05),
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

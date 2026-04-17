import path from "node:path";

export const appConfig = {
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  userPhotoTtlHours: Number(process.env.USER_PHOTO_TTL_HOURS ?? 24),
  matchMinCosine: Number(process.env.MATCH_MIN_COSINE ?? 0.2),
  displayMinPct: Number(process.env.DISPLAY_MIN_PCT ?? 60),
  displayMaxPct: Number(process.env.DISPLAY_MAX_PCT ?? 97),
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

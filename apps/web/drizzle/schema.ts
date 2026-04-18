import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const newId = () => crypto.randomUUID();
const now = () => new Date();

export const brands = sqliteTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  logoPath: text("logo_path"),
  primaryColor: text("primary_color").default("#FF5E3A"),
  accentColor: text("accent_color").default("#111111"),
  bgGradientFrom: text("bg_gradient_from").default("#1a0b2e"),
  bgGradientTo: text("bg_gradient_to").default("#0a0a0a"),
  headlineUz: text("headline_uz"),
  headlineRu: text("headline_ru"),
  subtitleUz: text("subtitle_uz"),
  subtitleRu: text("subtitle_ru"),
  ctaLabelUz: text("cta_label_uz"),
  ctaLabelRu: text("cta_label_ru"),
  ctaUrl: text("cta_url"),
  fontFamily: text("font_family"),
  idleTextUz: text("idle_text_uz"),
  idleTextRu: text("idle_text_ru"),
  promoCode: text("promo_code"),
  promoTextUz: text("promo_text_uz"),
  promoTextRu: text("promo_text_ru"),
  analyticsToken: text("analytics_token").notNull().unique(),
  active: integer("active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now),
});

export const celebrities = sqliteTable(
  "celebrities",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    name: text("name").notNull(),
    nameRu: text("name_ru"),
    descriptionUz: text("description_uz"),
    descriptionRu: text("description_ru"),
    descriptionEn: text("description_en"),
    wikidataId: text("wikidata_id"),
    category: text("category"),
    popularity: integer("popularity").notNull().default(0),
    gender: text("gender"),
    age: integer("age"),
    attrsSource: text("attrs_source"),
    active: integer("active", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now),
  },
  (t) => ({
    popularityIdx: index("celebrities_popularity_idx").on(t.popularity),
    genderIdx: index("celebrities_gender_idx").on(t.gender),
    wikidataIdx: index("celebrities_wikidata_id_idx").on(t.wikidataId),
  }),
);

export const celebrityPhotos = sqliteTable(
  "celebrity_photos",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    celebrityId: text("celebrity_id")
      .notNull()
      .references(() => celebrities.id, { onDelete: "cascade" }),
    photoPath: text("photo_path").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    faceQuality: text("face_quality"),
    detScore: real("det_score"),
    source: text("source"),
    sourceUrl: text("source_url"),
    blurScore: real("blur_score"),
    frontalScore: real("frontal_score"),
    overallScore: real("overall_score"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now),
  },
  (t) => ({
    celebIdx: index("celebrity_photos_celeb_idx").on(t.celebrityId),
    primaryIdx: uniqueIndex("celebrity_photos_primary_idx")
      .on(t.celebrityId)
      .where(sql`${t.isPrimary} = 1`),
    scoreIdx: index("celebrity_photos_score_idx").on(t.celebrityId, t.overallScore),
  }),
);

export type MatchAlternative = {
  celebrityId: string;
  celebrityPhotoId: string;
  similarity: number;
};

export const matchResults = sqliteTable(
  "match_results",
  {
    id: text("id").primaryKey().$defaultFn(newId),
    brandId: text("brand_id").references(() => brands.id),
    celebrityId: text("celebrity_id").references(() => celebrities.id, {
      onDelete: "set null",
    }),
    celebrityPhotoId: text("celebrity_photo_id").references(() => celebrityPhotos.id, {
      onDelete: "set null",
    }),
    similarity: real("similarity").notNull(),
    userPhotoPath: text("user_photo_path").notNull(),
    alternatives: text("alternatives", { mode: "json" }).$type<MatchAlternative[]>(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now),
  },
  (t) => ({
    expiresIdx: index("match_results_expires_idx").on(t.expiresAt),
    brandIdx: index("match_results_brand_idx").on(t.brandId, t.createdAt),
  }),
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: text("brand_id"),
    resultId: text("result_id"),
    eventType: text("event_type").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now),
  },
  (t) => ({
    brandIdx: index("events_brand_idx").on(t.brandId, t.createdAt),
    typeIdx: index("events_type_idx").on(t.eventType, t.createdAt),
  }),
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(now),
});

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Celebrity = typeof celebrities.$inferSelect;
export type CelebrityPhoto = typeof celebrityPhotos.$inferSelect;
export type MatchResult = typeof matchResults.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;

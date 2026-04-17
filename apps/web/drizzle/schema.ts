import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const brands = pgTable("brands", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  logoPath: text("logo_path"),
  primaryColor: text("primary_color").default("#FF5E3A"),
  accentColor: text("accent_color").default("#111111"),
  idleTextUz: text("idle_text_uz"),
  idleTextRu: text("idle_text_ru"),
  promoCode: text("promo_code"),
  promoTextUz: text("promo_text_uz"),
  promoTextRu: text("promo_text_ru"),
  analyticsToken: text("analytics_token").notNull().unique(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const celebrities = pgTable("celebrities", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
  name: text("name").notNull(),
  nameRu: text("name_ru"),
  descriptionUz: text("description_uz"),
  descriptionRu: text("description_ru"),
  descriptionEn: text("description_en"),
  wikidataId: text("wikidata_id"),
  category: text("category"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const celebrityPhotos = pgTable(
  "celebrity_photos",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    celebrityId: uuid("celebrity_id")
      .notNull()
      .references(() => celebrities.id, { onDelete: "cascade" }),
    photoPath: text("photo_path").notNull(),
    embedding: vector("embedding", { dimensions: 512 }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    faceQuality: text("face_quality"),
    detScore: real("det_score"),
    source: text("source"),
    sourceUrl: text("source_url"),
    blurScore: real("blur_score"),
    frontalScore: real("frontal_score"),
    overallScore: real("overall_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    embeddingIdx: index("celebrity_photos_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    celebIdx: index("celebrity_photos_celeb_idx").on(t.celebrityId),
    primaryIdx: uniqueIndex("celebrity_photos_primary_idx")
      .on(t.celebrityId)
      .where(sql`${t.isPrimary} = true`),
    scoreIdx: index("celebrity_photos_score_idx").on(t.celebrityId, t.overallScore),
  }),
);

export const matchResults = pgTable(
  "match_results",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    brandId: text("brand_id").references(() => brands.id),
    celebrityId: uuid("celebrity_id").references(() => celebrities.id, { onDelete: "set null" }),
    celebrityPhotoId: uuid("celebrity_photo_id").references(() => celebrityPhotos.id, {
      onDelete: "set null",
    }),
    similarity: real("similarity").notNull(),
    userPhotoPath: text("user_photo_path").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    expiresIdx: index("match_results_expires_idx").on(t.expiresAt),
    brandIdx: index("match_results_brand_idx").on(t.brandId, t.createdAt),
  }),
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    brandId: text("brand_id"),
    resultId: uuid("result_id"),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    brandIdx: index("events_brand_idx").on(t.brandId, t.createdAt),
    typeIdx: index("events_type_idx").on(t.eventType, t.createdAt),
  }),
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
export type Celebrity = typeof celebrities.$inferSelect;
export type CelebrityPhoto = typeof celebrityPhotos.$inferSelect;
export type MatchResult = typeof matchResults.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;

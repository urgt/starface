-- === Schema (idempotent) ===
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS "brands" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "logo_path" text,
  "primary_color" text DEFAULT '#FF5E3A',
  "accent_color" text DEFAULT '#111111',
  "idle_text_uz" text,
  "idle_text_ru" text,
  "promo_code" text,
  "promo_text_uz" text,
  "promo_text_ru" text,
  "analytics_token" text NOT NULL,
  "active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "brands_analytics_token_unique" UNIQUE ("analytics_token")
);

-- White-label expansion (idempotent)
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "bg_gradient_from" text DEFAULT '#1a0b2e';
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "bg_gradient_to"   text DEFAULT '#0a0a0a';
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "headline_uz"      text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "headline_ru"      text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "subtitle_uz"      text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "subtitle_ru"      text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "cta_label_uz"     text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "cta_label_ru"     text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "cta_url"          text;
ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "font_family"      text;

CREATE TABLE IF NOT EXISTS "celebrities" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
  "name" text NOT NULL,
  "name_ru" text,
  "description_uz" text,
  "description_ru" text,
  "description_en" text,
  "category" text,
  "active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

-- Legacy photo/embedding columns may still exist from earlier schema — keep until
-- backfill below runs, then drop.
ALTER TABLE "celebrities" ADD COLUMN IF NOT EXISTS "description_en" text;
ALTER TABLE "celebrities" ADD COLUMN IF NOT EXISTS "wikidata_id" text;
ALTER TABLE "celebrities" ADD COLUMN IF NOT EXISTS "popularity"  integer NOT NULL DEFAULT 0;
-- Face-attribute fields populated by apps/ml/app/enrich_attributes.py (reads
-- face.sex/face.age from InsightFace buffalo_l on the primary photo). Used by
-- /api/match to soft-penalise gender/age mismatch during re-rank.
ALTER TABLE "celebrities" ADD COLUMN IF NOT EXISTS "gender" text; -- 'M' | 'F' | NULL
ALTER TABLE "celebrities" ADD COLUMN IF NOT EXISTS "age" integer;
ALTER TABLE "celebrities" ADD COLUMN IF NOT EXISTS "attrs_source" text;
CREATE INDEX IF NOT EXISTS "celebrities_wikidata_id_idx" ON "celebrities" ("wikidata_id");
CREATE INDEX IF NOT EXISTS "celebrities_popularity_idx" ON "celebrities" ("popularity" DESC) WHERE "active" = true;
CREATE INDEX IF NOT EXISTS "celebrities_gender_idx" ON "celebrities" ("gender");
UPDATE "celebrities"
  SET "description_en" = "description_uz"
  WHERE "description_en" IS NULL
    AND "description_uz" IS NOT NULL
    AND "description_uz" != ''
    AND "description_uz" ~ '[A-Za-z]';
UPDATE "celebrities"
  SET "description_uz" = NULL
  WHERE "description_en" IS NOT NULL
    AND "description_uz" = "description_en";

-- === celebrity_photos (N photos per celebrity) ===
CREATE TABLE IF NOT EXISTS "celebrity_photos" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
  "celebrity_id" uuid NOT NULL REFERENCES "celebrities"("id") ON DELETE CASCADE,
  "photo_path" text NOT NULL,
  "embedding" vector(512) NOT NULL,
  "is_primary" boolean NOT NULL DEFAULT false,
  "face_quality" text,
  "det_score" real,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "celebrity_photos_embedding_idx" ON "celebrity_photos" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "celebrity_photos_celeb_idx" ON "celebrity_photos" ("celebrity_id");
CREATE UNIQUE INDEX IF NOT EXISTS "celebrity_photos_primary_idx"
  ON "celebrity_photos" ("celebrity_id") WHERE "is_primary" = true;

-- Enrichment agent fields (populated by apps/ml/app/enrich.py)
ALTER TABLE "celebrity_photos" ADD COLUMN IF NOT EXISTS "source"        text;
ALTER TABLE "celebrity_photos" ADD COLUMN IF NOT EXISTS "source_url"    text;
ALTER TABLE "celebrity_photos" ADD COLUMN IF NOT EXISTS "blur_score"    real;
ALTER TABLE "celebrity_photos" ADD COLUMN IF NOT EXISTS "frontal_score" real;
ALTER TABLE "celebrity_photos" ADD COLUMN IF NOT EXISTS "overall_score" real;
CREATE INDEX IF NOT EXISTS "celebrity_photos_score_idx"
  ON "celebrity_photos" ("celebrity_id", "overall_score" DESC);

-- === match_results ===
CREATE TABLE IF NOT EXISTS "match_results" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
  "brand_id" text REFERENCES "brands"("id"),
  "celebrity_id" uuid,
  "similarity" real NOT NULL,
  "user_photo_path" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "match_results" ADD COLUMN IF NOT EXISTS "celebrity_photo_id" uuid;
-- Runners-up from /api/match re-rank (top-2 after the winner). jsonb array of
-- { celebrityId, celebrityPhotoId, similarity } so the reveal UI can show a
-- "you also look like…" carousel without a second query.
ALTER TABLE "match_results" ADD COLUMN IF NOT EXISTS "alternatives" jsonb;

-- Replace FK on celebrity_id with ON DELETE SET NULL
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE table_name='match_results' AND constraint_name='match_results_celebrity_id_fkey') THEN
    ALTER TABLE "match_results" DROP CONSTRAINT "match_results_celebrity_id_fkey";
  END IF;
END $$;
ALTER TABLE "match_results"
  ADD CONSTRAINT "match_results_celebrity_id_fkey"
  FOREIGN KEY ("celebrity_id") REFERENCES "celebrities"("id") ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_name='match_results' AND constraint_name='match_results_celebrity_photo_id_fkey') THEN
    ALTER TABLE "match_results"
      ADD CONSTRAINT "match_results_celebrity_photo_id_fkey"
      FOREIGN KEY ("celebrity_photo_id") REFERENCES "celebrity_photos"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "brand_id" text,
  "result_id" uuid,
  "event_type" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "match_results_expires_idx" ON "match_results" ("expires_at");
CREATE INDEX IF NOT EXISTS "match_results_brand_idx" ON "match_results" ("brand_id", "created_at");
CREATE INDEX IF NOT EXISTS "events_brand_idx" ON "events" ("brand_id", "created_at");
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" ("event_type", "created_at");

-- === Backfill celebrity_photos from legacy celebrities.photo_path/embedding ===
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='celebrities' AND column_name='photo_path') THEN
    INSERT INTO celebrity_photos (celebrity_id, photo_path, embedding, is_primary)
      SELECT id, photo_path, embedding, true FROM celebrities
      WHERE photo_path IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM celebrity_photos cp WHERE cp.celebrity_id = celebrities.id);
  END IF;
END $$;

-- Drop legacy columns/index
DROP INDEX IF EXISTS "celebrities_embedding_idx";
ALTER TABLE "celebrities" DROP COLUMN IF EXISTS "photo_path";
ALTER TABLE "celebrities" DROP COLUMN IF EXISTS "embedding";

-- === app_settings (key-value) ===
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY,
  "value" text,
  "updated_at" timestamp with time zone DEFAULT now()
);
INSERT INTO "app_settings" ("key", "value") VALUES
  ('llm.base_url', 'http://127.0.0.1:1234/v1'),
  ('llm.api_key',  'lmstudio'),
  ('llm.model',    'google/gemma-4-e4b')
ON CONFLICT (key) DO NOTHING;

-- === Seed: demo brand (idempotent) ===
INSERT INTO brands (
  id, name, primary_color, accent_color,
  bg_gradient_from, bg_gradient_to,
  headline_uz, headline_ru, subtitle_uz, subtitle_ru,
  cta_label_uz, cta_label_ru, cta_url, font_family,
  idle_text_uz, idle_text_ru,
  promo_code, promo_text_uz, promo_text_ru,
  analytics_token, active
)
VALUES (
  'demo',
  'StarFace Demo',
  '#FF5E3A',
  '#111111',
  '#1a0b2e',
  '#0a0a0a',
  'Qaysi yulduzga o''xshaysiz?',
  'На кого из звёзд ты похож?',
  'Yaqinroq keling va kameraga ✌️ ko''rsating',
  'Подойди ближе и покажи ✌️ в камеру',
  'Yana bir marta',
  'Попробовать ещё раз',
  '/kiosk?brand=demo',
  'manrope',
  'Mashhurlardan kimga o''xshashingizni bilib oling!',
  'Узнай на кого из знаменитостей ты похож!',
  'STAR10',
  'Do''konda 10% chegirma',
  'Скидка 10% в магазине',
  'demo-analytics-token-change-me',
  true
)
ON CONFLICT (id) DO UPDATE SET
  bg_gradient_from = EXCLUDED.bg_gradient_from,
  bg_gradient_to   = EXCLUDED.bg_gradient_to,
  headline_uz      = COALESCE(brands.headline_uz, EXCLUDED.headline_uz),
  headline_ru      = COALESCE(brands.headline_ru, EXCLUDED.headline_ru),
  subtitle_uz      = COALESCE(brands.subtitle_uz, EXCLUDED.subtitle_uz),
  subtitle_ru      = COALESCE(brands.subtitle_ru, EXCLUDED.subtitle_ru),
  cta_label_uz     = COALESCE(brands.cta_label_uz, EXCLUDED.cta_label_uz),
  cta_label_ru     = COALESCE(brands.cta_label_ru, EXCLUDED.cta_label_ru),
  cta_url          = COALESCE(brands.cta_url, EXCLUDED.cta_url),
  font_family      = COALESCE(brands.font_family, EXCLUDED.font_family);

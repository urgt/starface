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

CREATE TABLE IF NOT EXISTS "celebrities" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
  "name" text NOT NULL,
  "name_ru" text,
  "description_uz" text,
  "description_ru" text,
  "category" text,
  "photo_path" text NOT NULL,
  "embedding" vector(512) NOT NULL,
  "active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "match_results" (
  "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
  "brand_id" text REFERENCES "brands"("id"),
  "celebrity_id" uuid REFERENCES "celebrities"("id"),
  "similarity" real NOT NULL,
  "user_photo_path" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "brand_id" text,
  "result_id" uuid,
  "event_type" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "celebrities_embedding_idx" ON "celebrities" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "match_results_expires_idx" ON "match_results" ("expires_at");
CREATE INDEX IF NOT EXISTS "match_results_brand_idx" ON "match_results" ("brand_id", "created_at");
CREATE INDEX IF NOT EXISTS "events_brand_idx" ON "events" ("brand_id", "created_at");
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" ("event_type", "created_at");

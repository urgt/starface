CREATE TABLE `brands` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `logo_path` text,
  `primary_color` text DEFAULT '#FF5E3A',
  `accent_color` text DEFAULT '#111111',
  `bg_gradient_from` text DEFAULT '#1a0b2e',
  `bg_gradient_to` text DEFAULT '#0a0a0a',
  `headline_uz` text,
  `headline_ru` text,
  `subtitle_uz` text,
  `subtitle_ru` text,
  `cta_label_uz` text,
  `cta_label_ru` text,
  `cta_url` text,
  `font_family` text,
  `idle_text_uz` text,
  `idle_text_ru` text,
  `promo_code` text,
  `promo_text_uz` text,
  `promo_text_ru` text,
  `analytics_token` text NOT NULL,
  `active` integer DEFAULT 1,
  `created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_analytics_token_unique` ON `brands` (`analytics_token`);
--> statement-breakpoint
CREATE TABLE `celebrities` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `name_ru` text,
  `description_uz` text,
  `description_ru` text,
  `description_en` text,
  `wikidata_id` text,
  `category` text,
  `popularity` integer DEFAULT 0 NOT NULL,
  `gender` text,
  `age` integer,
  `attrs_source` text,
  `active` integer DEFAULT 1,
  `created_at` integer
);
--> statement-breakpoint
CREATE INDEX `celebrities_popularity_idx` ON `celebrities` (`popularity`);
--> statement-breakpoint
CREATE INDEX `celebrities_gender_idx` ON `celebrities` (`gender`);
--> statement-breakpoint
CREATE INDEX `celebrities_wikidata_id_idx` ON `celebrities` (`wikidata_id`);
--> statement-breakpoint
CREATE TABLE `celebrity_photos` (
  `id` text PRIMARY KEY NOT NULL,
  `celebrity_id` text NOT NULL,
  `photo_path` text NOT NULL,
  `is_primary` integer DEFAULT 0 NOT NULL,
  `face_quality` text,
  `det_score` real,
  `source` text,
  `source_url` text,
  `blur_score` real,
  `frontal_score` real,
  `overall_score` real,
  `created_at` integer,
  FOREIGN KEY (`celebrity_id`) REFERENCES `celebrities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `celebrity_photos_celeb_idx` ON `celebrity_photos` (`celebrity_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `celebrity_photos_primary_idx` ON `celebrity_photos` (`celebrity_id`) WHERE `is_primary` = 1;
--> statement-breakpoint
CREATE INDEX `celebrity_photos_score_idx` ON `celebrity_photos` (`celebrity_id`, `overall_score`);
--> statement-breakpoint
CREATE TABLE `match_results` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_id` text,
  `celebrity_id` text,
  `celebrity_photo_id` text,
  `similarity` real NOT NULL,
  `user_photo_path` text NOT NULL,
  `alternatives` text,
  `expires_at` integer NOT NULL,
  `created_at` integer,
  FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`celebrity_id`) REFERENCES `celebrities`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`celebrity_photo_id`) REFERENCES `celebrity_photos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `match_results_expires_idx` ON `match_results` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `match_results_brand_idx` ON `match_results` (`brand_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `brand_id` text,
  `result_id` text,
  `event_type` text NOT NULL,
  `metadata` text,
  `created_at` integer
);
--> statement-breakpoint
CREATE INDEX `events_brand_idx` ON `events` (`brand_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`event_type`, `created_at`);
--> statement-breakpoint
CREATE TABLE `app_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text,
  `updated_at` integer
);
--> statement-breakpoint
INSERT INTO `brands` (
  `id`, `name`, `primary_color`, `accent_color`,
  `bg_gradient_from`, `bg_gradient_to`,
  `headline_uz`, `headline_ru`, `subtitle_uz`, `subtitle_ru`,
  `cta_label_uz`, `cta_label_ru`, `cta_url`, `font_family`,
  `idle_text_uz`, `idle_text_ru`,
  `promo_code`, `promo_text_uz`, `promo_text_ru`,
  `analytics_token`, `active`
) VALUES (
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
  1
);

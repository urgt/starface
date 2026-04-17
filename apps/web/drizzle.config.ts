import type { Config } from "drizzle-kit";

export default {
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://starface:starface@localhost:5432/starface",
  },
  verbose: true,
  strict: true,
} satisfies Config;

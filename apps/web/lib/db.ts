import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/drizzle/schema";

declare global {
  // eslint-disable-next-line no-var
  var __sfPgClient: ReturnType<typeof postgres> | undefined;
}

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://starface:starface@localhost:5432/starface";

const client = global.__sfPgClient ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  global.__sfPgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "@/drizzle/schema";

type AppDb = DrizzleD1Database<typeof schema>;

function makeDb(): AppDb {
  const { env } = getCloudflareContext();
  return drizzle(env.DB, { schema });
}

export const db = new Proxy({} as AppDb, {
  get(_target, prop, receiver) {
    const real = makeDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };

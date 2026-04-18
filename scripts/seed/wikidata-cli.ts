import { parseArgs } from "node:util";

import { config } from "./config.ts";
import { fetchCategory, saveManifest, type Category, type WikidataEntry } from "./wikidata.ts";

async function main() {
  const { values } = parseArgs({
    options: {
      category: { type: "string", default: "all" },
      limit: { type: "string" },
      "out-dir": { type: "string", default: config.seedOutDir },
    },
  });

  const cats: Category[] =
    values.category === "all"
      ? ["uz", "cis", "world"]
      : [values.category as Category];

  const limits: Record<Category, number> = {
    uz: values.limit ? Number(values.limit) : 300,
    cis: values.limit ? Number(values.limit) : 700,
    world: values.limit ? Number(values.limit) : 1500,
  };

  const out = values["out-dir"] as string;
  const all: WikidataEntry[] = [];
  for (const cat of cats) {
    const entries = await fetchCategory(cat, limits[cat], out);
    all.push(...entries);
  }

  const path = saveManifest(out, all);
  console.log(`\n[wikidata] manifest written: ${path} (${all.length} entries)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

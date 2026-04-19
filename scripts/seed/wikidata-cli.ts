import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { config } from "./config.ts";
import {
  fetchByIds,
  fetchCategory,
  saveManifest,
  type Category,
  type WikidataEntry,
} from "./wikidata.ts";

type Preset = {
  name: string;
  category: Category;
  description?: string;
  ids: string[];
};

async function main() {
  const { values } = parseArgs({
    options: {
      category: { type: "string", default: "all" },
      limit: { type: "string" },
      "out-dir": { type: "string", default: config.seedOutDir },
      preset: { type: "string" },
    },
  });

  const out = values["out-dir"] as string;
  const all: WikidataEntry[] = [];

  if (values.preset) {
    const path = values.preset as string;
    if (!existsSync(path)) {
      console.error(`preset not found: ${path}`);
      process.exit(2);
    }
    const preset = JSON.parse(readFileSync(path, "utf-8")) as Preset;
    if (!preset.ids?.length) {
      console.error(`preset has no ids: ${path}`);
      process.exit(2);
    }
    const entries = await fetchByIds(preset.ids, preset.category, out);
    all.push(...entries);
  } else {
    const cats: Category[] =
      values.category === "all"
        ? ["uz", "cis", "world"]
        : [values.category as Category];

    const limits: Record<Category, number> = {
      uz: values.limit ? Number(values.limit) : 300,
      cis: values.limit ? Number(values.limit) : 700,
      world: values.limit ? Number(values.limit) : 1500,
    };

    for (const cat of cats) {
      const entries = await fetchCategory(cat, limits[cat], out);
      all.push(...entries);
    }
  }

  const path = saveManifest(out, all);
  console.log(`\n[wikidata] manifest written: ${path} (${all.length} entries)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

# Curated Wikidata presets

Small JSON files that pin the kiosk's celebrity catalogue to a hand-picked list
of Wikidata entities. Useful when the default SPARQL rankings (ordered by
sitelinks) miss regional figures or include duplicates.

## Format

```json
{
  "name": "uz-essentials",
  "category": "uz",
  "description": "High-priority Uzbek figures, hand-curated.",
  "ids": ["Q123456", "Q789012"]
}
```

- `category` — one of `uz`, `cis`, `world`. Stored on the resulting
  `celebrityPhotos.source` so match events can be filtered by region.
- `ids` — Wikidata QIDs. Duplicates are removed; invalid shapes are skipped.

## Running

```bash
# Fetch photos for a preset (reuses the existing SPARQL + download pipeline):
pnpm --filter @starface/scripts fetch-wikidata --preset scripts/seed/presets/uz-essentials.json

# Then enroll as usual:
cd scripts/seed/py && uv run python enroll.py
```

Presets and `--category` are mutually exclusive — pass one or the other.

## Curating a new preset

1. Create a JSON file here (e.g. `uz-singers-2020s.json`).
2. Populate `ids` by searching Wikidata manually, starting from a seed query
   (`SELECT ?p WHERE { ?p wdt:P106 wd:Q177220; wdt:P27 wd:Q265 }`) and verifying
   each QID points to the right person + has a CC-BY image on `wdt:P18`.
3. Commit the preset JSON. The photos themselves are not committed — they're
   downloaded on demand into `$SEED_OUT_DIR/photos/`.

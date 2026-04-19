export type WikidataPreset = {
  id: string;
  label: string;
  description: string;
  category: "uz" | "cis" | "world";
  sparql: string;
};

const ENRICHMENT_TAIL = `
  OPTIONAL { ?person wdt:P18 ?image. }
  OPTIONAL { ?person wdt:P569 ?dob. }
  OPTIONAL { ?person wdt:P570 ?dod. }
  OPTIONAL { ?person wdt:P106 ?occupation. }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?person rdfs:label ?personLabel.
    ?occupation rdfs:label ?occupationLabel.
  }
  OPTIONAL {
    ?person rdfs:label ?personRuLabel.
    FILTER(LANG(?personRuLabel) = "ru").
  }
`;

// Wikidata's SPARQL planner chokes on "all humans ORDER BY sitelinks" style queries.
// Each preset pushes the selective join into a nested SELECT that applies LIMIT
// before enrichment — this is what keeps them under the Wikidata 60s wall clock.
export const PRESETS: WikidataPreset[] = [
  {
    id: "uz",
    label: "Uzbekistan",
    description:
      "Citizens of Uzbekistan (P27 = Q265), sorted by Wikipedia notability (sitelinks).",
    category: "uz",
    sparql: `
      SELECT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        {
          SELECT ?person ?sitelinks WHERE {
            ?person wdt:P31 wd:Q5.
            ?person wdt:P27 wd:Q265.
            ?person wikibase:sitelinks ?sitelinks.
          } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
        }
        ${ENRICHMENT_TAIL}
      } ORDER BY DESC(?sitelinks)
    `,
  },
  {
    id: "cis",
    label: "CIS (RU / KZ / KG)",
    description:
      "Citizens of Russia, Kazakhstan, or Kyrgyzstan, sorted by Wikipedia notability (sitelinks).",
    category: "cis",
    sparql: `
      SELECT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        {
          {
            SELECT ?person ?sitelinks WHERE {
              ?person wdt:P31 wd:Q5.
              ?person wdt:P27 wd:Q159.
              ?person wikibase:sitelinks ?sitelinks.
            } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
          }
        } UNION {
          {
            SELECT ?person ?sitelinks WHERE {
              ?person wdt:P31 wd:Q5.
              ?person wdt:P27 wd:Q232.
              ?person wikibase:sitelinks ?sitelinks.
            } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
          }
        } UNION {
          {
            SELECT ?person ?sitelinks WHERE {
              ?person wdt:P31 wd:Q5.
              ?person wdt:P27 wd:Q813.
              ?person wikibase:sitelinks ?sitelinks.
            } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
          }
        }
        ${ENRICHMENT_TAIL}
      } ORDER BY DESC(?sitelinks)
    `,
  },
  {
    id: "world",
    label: "World",
    description:
      "Most notable actors, musicians, and athletes worldwide. Wikidata cannot sort 'all humans by sitelinks' in time, so we aggregate by occupation.",
    category: "world",
    sparql: `
      SELECT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        {
          {
            SELECT ?person ?sitelinks WHERE {
              { ?person wdt:P106 wd:Q33999. } UNION { ?person wdt:P106 wd:Q10800557. }
              ?person wdt:P31 wd:Q5.
              ?person wikibase:sitelinks ?sitelinks.
            } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
          }
        } UNION {
          {
            SELECT ?person ?sitelinks WHERE {
              { ?person wdt:P106 wd:Q177220. } UNION { ?person wdt:P106 wd:Q639669. } UNION { ?person wdt:P106 wd:Q753110. }
              ?person wdt:P31 wd:Q5.
              ?person wikibase:sitelinks ?sitelinks.
            } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
          }
        } UNION {
          {
            SELECT ?person ?sitelinks WHERE {
              ?person wdt:P106 wd:Q2066131.
              ?person wdt:P31 wd:Q5.
              ?person wikibase:sitelinks ?sitelinks.
            } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
          }
        }
        ${ENRICHMENT_TAIL}
      } ORDER BY DESC(?sitelinks)
    `,
  },
];

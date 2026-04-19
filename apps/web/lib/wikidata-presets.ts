export type WikidataPreset = {
  id: string;
  label: string;
  description: string;
  category: "uz" | "cis" | "world";
  sparql: string;
};

const PERSON_FIELDS = `
  OPTIONAL { ?person wdt:P18 ?image. }
  OPTIONAL { ?person wdt:P569 ?dob. }
  OPTIONAL { ?person wdt:P570 ?dod. }
  OPTIONAL { ?person wdt:P106 ?occupation. }
  ?person wikibase:sitelinks ?sitelinks.
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

export const PRESETS: WikidataPreset[] = [
  {
    id: "uz",
    label: "Uzbekistan",
    description:
      "Citizens of Uzbekistan (P27 = Q265), sorted by Wikipedia notability (sitelinks).",
    category: "uz",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        ?person wdt:P31 wd:Q5.
        ?person wdt:P27 wd:Q265.
        ${PERSON_FIELDS}
      } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
    `,
  },
  {
    id: "cis",
    label: "CIS (RU / KZ / KG)",
    description:
      "Citizens of Russia, Kazakhstan, or Kyrgyzstan, sorted by Wikipedia notability (sitelinks).",
    category: "cis",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        ?person wdt:P31 wd:Q5.
        VALUES ?country { wd:Q159 wd:Q232 wd:Q813 }
        ?person wdt:P27 ?country.
        ${PERSON_FIELDS}
      } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
    `,
  },
  {
    id: "world",
    label: "World",
    description:
      "Humans with Wikipedia sitelinks >= 30, sorted by sitelinks (worldwide notability).",
    category: "world",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        ?person wdt:P31 wd:Q5.
        ${PERSON_FIELDS}
        FILTER(?sitelinks >= 30).
      } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
    `,
  },
];

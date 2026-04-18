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
    id: "uz-actors",
    label: "Uzbek actors",
    description:
      "People with citizenship=Uzbekistan and occupation in {actor, film actor, television actor}.",
    category: "uz",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel WHERE {
        ?person wdt:P31 wd:Q5.
        ?person wdt:P27 wd:Q265.
        VALUES ?job { wd:Q33999 wd:Q10800557 wd:Q10798782 }
        ?person wdt:P106 ?job.
        ${PERSON_FIELDS}
      } LIMIT {{LIMIT}}
    `,
  },
  {
    id: "uz-musicians",
    label: "Uzbek musicians",
    description: "Citizenship=Uzbekistan, occupation in {musician, singer, composer}.",
    category: "uz",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel WHERE {
        ?person wdt:P31 wd:Q5.
        ?person wdt:P27 wd:Q265.
        VALUES ?job { wd:Q177220 wd:Q639669 wd:Q36834 }
        ?person wdt:P106 ?job.
        ${PERSON_FIELDS}
      } LIMIT {{LIMIT}}
    `,
  },
  {
    id: "cis-actors",
    label: "CIS actors (RU/KZ/KG)",
    description: "Actors with citizenship in {Russia, Kazakhstan, Kyrgyzstan}.",
    category: "cis",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel WHERE {
        ?person wdt:P31 wd:Q5.
        VALUES ?country { wd:Q159 wd:Q232 wd:Q813 }
        ?person wdt:P27 ?country.
        VALUES ?job { wd:Q33999 wd:Q10800557 wd:Q10798782 }
        ?person wdt:P106 ?job.
        ${PERSON_FIELDS}
      } LIMIT {{LIMIT}}
    `,
  },
  {
    id: "world-actors",
    label: "World A-list actors",
    description: "Highly linked actors (sitelinks >= 30).",
    category: "world",
    sparql: `
      SELECT DISTINCT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?occupationLabel ?sitelinks WHERE {
        ?person wdt:P31 wd:Q5.
        VALUES ?job { wd:Q33999 wd:Q10800557 wd:Q10798782 }
        ?person wdt:P106 ?job.
        ?person wikibase:sitelinks ?sitelinks.
        FILTER(?sitelinks >= 30).
        ${PERSON_FIELDS}
      } ORDER BY DESC(?sitelinks) LIMIT {{LIMIT}}
    `,
  },
];

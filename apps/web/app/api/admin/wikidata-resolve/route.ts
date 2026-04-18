import { NextResponse } from "next/server";

import { runSparql } from "@/lib/wikidata-query";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RESOLVE_QUERY = `
  SELECT ?person ?personLabel ?personRuLabel ?image ?dob ?dod ?genderLabel ?occupationLabel WHERE {
    VALUES ?person { wd:{{QID}} }
    OPTIONAL { ?person wdt:P18 ?image. }
    OPTIONAL { ?person wdt:P21 ?gender. }
    OPTIONAL { ?person wdt:P569 ?dob. }
    OPTIONAL { ?person wdt:P570 ?dod. }
    OPTIONAL { ?person wdt:P106 ?occupation. }
    SERVICE wikibase:label {
      bd:serviceParam wikibase:language "en".
      ?person rdfs:label ?personLabel.
      ?gender rdfs:label ?genderLabel.
      ?occupation rdfs:label ?occupationLabel.
    }
    OPTIONAL {
      ?person rdfs:label ?personRuLabel.
      FILTER(LANG(?personRuLabel) = "ru").
    }
  } LIMIT {{LIMIT}}
`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qid = url.searchParams.get("qid");
  if (!qid || !/^Q\d+$/.test(qid)) {
    return NextResponse.json({ error: "bad_qid" }, { status: 400 });
  }
  try {
    const rows = await runSparql(RESOLVE_QUERY.replaceAll("{{QID}}", qid), 1);
    if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ candidate: rows[0] });
  } catch (e) {
    return NextResponse.json(
      { error: "sparql_failed", detail: (e as Error).message },
      { status: 502 },
    );
  }
}

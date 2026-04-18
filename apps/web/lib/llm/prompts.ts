import type { Language } from "./schema";

export type CelebrityInput = {
  name: string;
  nameRu: string | null;
  wikidataId: string | null;
  category: string | null;
  gender: string | null;
  age: number | null;
};

export type WikipediaContext = {
  en: string | null;
  ru: string | null;
  uz: string | null;
};

const EXCERPT_MAX_CHARS = 800;
const EXISTING_MAX_CHARS = 500;

function sanitize(text: string, tagName: string, maxChars: number): string {
  const stripped = text.replaceAll(`</${tagName}>`, "");
  return stripped.length > maxChars ? stripped.slice(0, maxChars) : stripped;
}

export function buildDescriptionPrompt(
  celeb: CelebrityInput,
  wiki: WikipediaContext | null,
  languages: Language[],
  existing?: Partial<Record<Language, string>>,
): string {
  const parts: string[] = [
    "You are writing a short biographical description of a public figure for a celebrity-match kiosk. Produce 2-3 sentences per language. Neutral tone. Include the most notable fact (profession, main achievement, era). Do not invent facts. If uncertain, omit the doubtful fact.",
    "",
    `Celebrity name: ${celeb.name}`,
    `Russian name: ${celeb.nameRu ?? "-"}`,
    `Wikidata ID: ${celeb.wikidataId ?? "-"}`,
    `Category: ${celeb.category ?? "-"}`,
    `Gender: ${celeb.gender ?? "-"}`,
    `Age (approx): ${celeb.age ?? "-"}`,
    "",
  ];

  if (wiki) {
    if (wiki.en) parts.push(`<excerpt lang="en">${sanitize(wiki.en, "excerpt", EXCERPT_MAX_CHARS)}</excerpt>`);
    if (wiki.ru) parts.push(`<excerpt lang="ru">${sanitize(wiki.ru, "excerpt", EXCERPT_MAX_CHARS)}</excerpt>`);
    if (wiki.uz) parts.push(`<excerpt lang="uz">${sanitize(wiki.uz, "excerpt", EXCERPT_MAX_CHARS)}</excerpt>`);
    parts.push("");
  }

  if (existing) {
    for (const lang of languages) {
      const text = existing[lang];
      if (text && text.length > 0) {
        parts.push(
          `Improve the following existing text rather than replace it with unrelated content. Do not invent facts. Existing ${lang} text: <existing>${sanitize(text, "existing", EXISTING_MAX_CHARS)}</existing>`,
        );
      }
    }
    parts.push("");
  }

  parts.push(
    `Return a JSON object with fields ${languages.join(", ")}. Each value is 2-3 sentences in that language. For the Uzbek field, use standard Latin-script Uzbek (not Cyrillic).`,
  );

  return parts.join("\n");
}

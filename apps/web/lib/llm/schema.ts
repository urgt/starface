import { z } from "zod";

export type Language = "uz" | "ru" | "en";
export const LANGUAGES: Language[] = ["uz", "ru", "en"];

export const descriptionsSchema = z.object({
  uz: z.string().min(1).optional(),
  ru: z.string().min(1).optional(),
  en: z.string().min(1).optional(),
});

export type GeneratedDescriptions = z.infer<typeof descriptionsSchema>;

export function buildGeminiResponseSchema(languages: Language[]) {
  const properties: Record<string, { type: "string" }> = {};
  for (const lang of languages) properties[lang] = { type: "string" };
  return {
    type: "object" as const,
    properties,
    required: languages,
  };
}

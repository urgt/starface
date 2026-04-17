import type { CSSProperties } from "react";
import { fontFamilyVar, type Locale } from "@/lib/i18n";

export type BrandTheme = {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  bgGradientFrom: string;
  bgGradientTo: string;
  headlineUz: string | null;
  headlineRu: string | null;
  subtitleUz: string | null;
  subtitleRu: string | null;
  idleTextUz: string | null;
  idleTextRu: string | null;
  ctaLabelUz: string | null;
  ctaLabelRu: string | null;
  ctaUrl: string | null;
  fontFamily: string | null;
  promoCode: string | null;
  promoTextUz: string | null;
  promoTextRu: string | null;
};

export const DEFAULT_BRAND_THEME: BrandTheme = {
  id: "__default",
  name: "StarFace",
  logoUrl: null,
  primaryColor: "#FF5E3A",
  accentColor: "#111111",
  bgGradientFrom: "#1a0b2e",
  bgGradientTo: "#0a0a0a",
  headlineUz: null,
  headlineRu: null,
  subtitleUz: null,
  subtitleRu: null,
  idleTextUz: null,
  idleTextRu: null,
  ctaLabelUz: null,
  ctaLabelRu: null,
  ctaUrl: null,
  fontFamily: "manrope",
  promoCode: null,
  promoTextUz: null,
  promoTextRu: null,
};

type DbBrandRow = {
  id: string;
  name: string;
  logoPath: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  bgGradientFrom: string | null;
  bgGradientTo: string | null;
  headlineUz: string | null;
  headlineRu: string | null;
  subtitleUz: string | null;
  subtitleRu: string | null;
  idleTextUz: string | null;
  idleTextRu: string | null;
  ctaLabelUz: string | null;
  ctaLabelRu: string | null;
  ctaUrl: string | null;
  fontFamily: string | null;
  promoCode: string | null;
  promoTextUz: string | null;
  promoTextRu: string | null;
};

export function brandThemeFromRow(row: DbBrandRow): BrandTheme {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoPath ? `/api/files/${row.logoPath}` : null,
    primaryColor: row.primaryColor ?? DEFAULT_BRAND_THEME.primaryColor,
    accentColor: row.accentColor ?? DEFAULT_BRAND_THEME.accentColor,
    bgGradientFrom: row.bgGradientFrom ?? DEFAULT_BRAND_THEME.bgGradientFrom,
    bgGradientTo: row.bgGradientTo ?? DEFAULT_BRAND_THEME.bgGradientTo,
    headlineUz: row.headlineUz,
    headlineRu: row.headlineRu,
    subtitleUz: row.subtitleUz,
    subtitleRu: row.subtitleRu,
    idleTextUz: row.idleTextUz,
    idleTextRu: row.idleTextRu,
    ctaLabelUz: row.ctaLabelUz,
    ctaLabelRu: row.ctaLabelRu,
    ctaUrl: row.ctaUrl,
    fontFamily: row.fontFamily,
    promoCode: row.promoCode,
    promoTextUz: row.promoTextUz,
    promoTextRu: row.promoTextRu,
  };
}

export function brandCssVars(theme: BrandTheme): CSSProperties {
  return {
    "--brand-primary": theme.primaryColor,
    "--brand-accent": theme.accentColor,
    "--brand-gradient-from": theme.bgGradientFrom,
    "--brand-gradient-to": theme.bgGradientTo,
    "--brand-font": fontFamilyVar(theme.fontFamily),
  } as CSSProperties;
}

export function brandHeadline(theme: BrandTheme, locale: Locale): string | null {
  return locale === "ru" ? theme.headlineRu : theme.headlineUz;
}

export function brandSubtitle(theme: BrandTheme, locale: Locale): string | null {
  return locale === "ru" ? theme.subtitleRu : theme.subtitleUz;
}

export function brandCtaLabel(theme: BrandTheme, locale: Locale): string | null {
  return locale === "ru" ? theme.ctaLabelRu : theme.ctaLabelUz;
}

export function brandPromoText(theme: BrandTheme, locale: Locale): string | null {
  return locale === "ru" ? theme.promoTextRu : theme.promoTextUz;
}

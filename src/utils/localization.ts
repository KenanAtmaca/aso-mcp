export const COUNTRY_NAMES: Record<string, string> = {
  tr: "Turkey",
  us: "United States",
  gb: "United Kingdom",
  de: "Germany",
  fr: "France",
  es: "Spain",
  it: "Italy",
  nl: "Netherlands",
  br: "Brazil",
  jp: "Japan",
  kr: "South Korea",
  cn: "China",
  au: "Australia",
  ca: "Canada",
  mx: "Mexico",
  ru: "Russia",
  in: "India",
  sa: "Saudi Arabia",
  ae: "United Arab Emirates",
  se: "Sweden",
};

export function getCountryName(code: string): string {
  return COUNTRY_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

export function isValidCountryCode(code: string): boolean {
  return /^[a-z]{2}$/i.test(code);
}

// ─── App Store Connect Locale Mapping ───

export const COUNTRY_TO_LOCALE: Record<string, string> = {
  tr: "tr",
  us: "en-US",
  gb: "en-GB",
  au: "en-AU",
  ca: "en-CA",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  it: "it",
  nl: "nl-NL",
  br: "pt-BR",
  jp: "ja",
  kr: "ko",
  cn: "zh-Hans",
  ru: "ru",
  in: "hi",
  sa: "ar-SA",
  ae: "ar-SA",
  se: "sv",
  mx: "es-MX",
};

const LOCALE_TO_COUNTRY: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_TO_LOCALE).map(([k, v]) => [v, k])
);

export function countryToLocale(code: string): string {
  // If it already looks like an Apple locale (contains dash or is longer than 2 chars), return as-is
  if (code.includes("-") || code.length > 2) {
    return code;
  }
  return COUNTRY_TO_LOCALE[code.toLowerCase()] ?? code;
}

export function localeToCountry(locale: string): string {
  return LOCALE_TO_COUNTRY[locale] ?? locale.toLowerCase();
}

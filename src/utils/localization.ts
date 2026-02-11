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

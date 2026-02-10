export const COUNTRY_NAMES: Record<string, string> = {
  tr: "Turkiye",
  us: "Amerika Birlesik Devletleri",
  gb: "Birlesik Krallik",
  de: "Almanya",
  fr: "Fransa",
  es: "Ispanya",
  it: "Italya",
  nl: "Hollanda",
  br: "Brezilya",
  jp: "Japonya",
  kr: "Guney Kore",
  cn: "Cin",
  au: "Avustralya",
  ca: "Kanada",
  mx: "Meksika",
  ru: "Rusya",
  in: "Hindistan",
  sa: "Suudi Arabistan",
  ae: "Birlesik Arap Emirlikleri",
  se: "Isvec",
};

export function getCountryName(code: string): string {
  return COUNTRY_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

export function isValidCountryCode(code: string): boolean {
  return /^[a-z]{2}$/i.test(code);
}

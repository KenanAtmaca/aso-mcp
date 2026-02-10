// App Store metadata karakter limitleri
export const CHAR_LIMITS = {
  TITLE: 30,
  SUBTITLE: 30,
  KEYWORD_FIELD: 100,
} as const;

// Cache TTL degerleri (saniye)
export const CACHE_TTL = {
  KEYWORD_SCORES: 3600,       // 1 saat
  APP_DETAILS: 21600,         // 6 saat
  SEARCH_RESULTS: 3600,       // 1 saat
  REVIEWS: 86400,             // 24 saat
  SIMILAR_APPS: 86400,        // 24 saat
  VERSION_HISTORY: 604800,    // 7 gun
  SUGGESTIONS: 3600,          // 1 saat
} as const;

// Rate limit ayarlari
export const RATE_LIMITS = {
  "app-store-scraper": { maxRequests: 20, windowMs: 60_000 },
  "aso-scores": { maxRequests: 10, windowMs: 60_000 },
  "apple-search-ads": { maxRequests: 100, windowMs: 3_600_000 },
} as const;

// Desteklenen ulkeler (en cok kullanilan)
export const POPULAR_COUNTRIES = [
  "tr", "us", "gb", "de", "fr", "es", "it", "nl", "br", "jp",
  "kr", "cn", "au", "ca", "mx", "ru", "in", "sa", "ae", "se",
] as const;

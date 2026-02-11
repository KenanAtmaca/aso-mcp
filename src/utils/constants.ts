// App Store metadata character limits
export const CHAR_LIMITS = {
  TITLE: 30,
  SUBTITLE: 30,
  KEYWORD_FIELD: 100,
} as const;

// Cache TTL values (seconds)
export const CACHE_TTL = {
  KEYWORD_SCORES: 3600,       // 1 hour
  APP_DETAILS: 21600,         // 6 hours
  SEARCH_RESULTS: 3600,       // 1 hour
  REVIEWS: 86400,             // 24 hours
  SIMILAR_APPS: 86400,        // 24 hours
  VERSION_HISTORY: 604800,    // 7 days
  SUGGESTIONS: 3600,          // 1 hour
} as const;

// Rate limit settings
export const RATE_LIMITS = {
  "app-store-scraper": { maxRequests: 20, windowMs: 60_000 },
  "aso-scores": { maxRequests: 10, windowMs: 60_000 },
  "apple-search-ads": { maxRequests: 100, windowMs: 3_600_000 },
} as const;

// Supported countries (most used)
export const POPULAR_COUNTRIES = [
  "tr", "us", "gb", "de", "fr", "es", "it", "nl", "br", "jp",
  "kr", "cn", "au", "ca", "mx", "ru", "in", "sa", "ae", "se",
] as const;

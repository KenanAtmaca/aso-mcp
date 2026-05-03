/**
 * Custom ASO Scoring Algorithm
 * Provides self-calculated metrics independent of Apple Search Ads popularity issues.
 */

export interface CustomScore {
  visibilityScore: number;   // 0-10: App's overall visibility
  competitiveScore: number;  // 0-10: Competitive strength
  opportunityScore: number;  // 0-10: Opportunity score (higher = better opportunity)
  overallScore: number;      // 0-10: Overall ASO score
}

export interface KeywordOpportunity {
  keyword: string;
  score: number;
  reason: string;
}

/**
 * Calculates visibility score from an app's ASO metrics.
 * Weights factors like rating, review count, and ranking.
 */
export function calculateVisibilityScore(params: {
  rating: number;
  reviewCount: number;
  rankInKeyword?: number;
  totalAppsInKeyword?: number;
}): number {
  const { rating, reviewCount, rankInKeyword, totalAppsInKeyword } = params;

  // Rating contribution (0-3 points): 4.5+ = 3, 4.0+ = 2, 3.0+ = 1
  const ratingScore = rating >= 4.5 ? 3 : rating >= 4.0 ? 2 : rating >= 3.0 ? 1 : 0;

  // Review count contribution (0-3 points): logarithmic scale
  const reviewScore = Math.min(3, Math.log10(Math.max(1, reviewCount)) / 1.5);

  // Ranking contribution (0-4 points)
  let rankScore = 2; // default medium
  if (rankInKeyword !== undefined && totalAppsInKeyword) {
    const percentile = 1 - rankInKeyword / totalAppsInKeyword;
    rankScore = percentile * 4;
  }

  return Math.min(10, ratingScore + reviewScore + rankScore);
}

/**
 * Calculates the competitive score for a keyword.
 * Determines difficulty by analyzing the strength of top-ranking apps.
 */
export function calculateCompetitiveScore(topApps: {
  rating: number;
  reviews: number;
  free: boolean;
}[]): number {
  if (topApps.length === 0) return 0;

  const avgRating =
    topApps.reduce((sum, a) => sum + (a.rating || 0), 0) / topApps.length;
  const avgReviews =
    topApps.reduce((sum, a) => sum + (a.reviews || 0), 0) / topApps.length;
  const freeRatio =
    topApps.filter((a) => a.free).length / topApps.length;

  // High rating = harder (0-3)
  const ratingDifficulty = (avgRating / 5) * 3;

  // Many reviews = harder (0-4, logarithmic)
  const reviewDifficulty = Math.min(4, Math.log10(Math.max(1, avgReviews)) / 1.25);

  // Mostly free = harder (0-3)
  const freeDifficulty = freeRatio * 3;

  return Math.min(10, ratingDifficulty + reviewDifficulty + freeDifficulty);
}

/**
 * Keyword opportunity score: High traffic + low difficulty = high opportunity
 */
export function calculateOpportunityScore(
  traffic: number,
  difficulty: number
): number {
  if (traffic === 0 && difficulty === 0) return 5;
  // high traffic + low difficulty = high score
  const raw = (traffic * 1.5 - difficulty * 0.8 + 5);
  return Math.max(0, Math.min(10, raw));
}

/**
 * Combines all scores to produce an overall ASO score.
 */
export function calculateOverallScore(params: {
  visibilityScore: number;
  competitiveScore: number;
  opportunityScore: number;
}): number {
  const { visibilityScore, competitiveScore, opportunityScore } = params;
  // Weights: visibility 40%, opportunity 35%, competitive (inverse) 25%
  const competitiveInverse = 10 - competitiveScore;
  return (
    visibilityScore * 0.4 +
    opportunityScore * 0.35 +
    competitiveInverse * 0.25
  );
}

/**
 * Canonicalize a keyword to its singular/root form so plural variants do
 * not double-count in keyword pools. App Store search treats these the same:
 * indexing "trackers" already covers "tracker" and vice versa, so suggesting
 * both wastes one of the precious 100 keyword-field characters.
 *
 * Conservative rules only (false positives like "us" → "u" must be avoided):
 *   English: -ies → -y, -ches/-shes/-xes/-ses → strip -es, plain -s with safe stem
 *   Turkish: -lar / -ler suffix removal
 */
export function canonicalKeyword(kw: string): string {
  let k = kw.toLowerCase().trim();
  if (k.length <= 3) return k;

  // English: -ies → -y (categories → category)
  if (k.length > 4 && k.endsWith("ies")) {
    return k.slice(0, -3) + "y";
  }
  // English: -ches / -shes / -xes / -ses → strip -es (boxes → box)
  if (
    k.length > 4 &&
    (k.endsWith("ches") || k.endsWith("shes") || k.endsWith("xes") || k.endsWith("sses"))
  ) {
    return k.slice(0, -2);
  }
  // English: plain -s → strip (trackers → tracker), avoiding -ss/-us/-is.
  // Require length > 4 so 4-char words (kurs, koss, cats) aren't aggressively
  // stripped. Short stems are more often real words than plurals.
  if (
    k.length > 4 &&
    k.endsWith("s") &&
    !k.endsWith("ss") &&
    !k.endsWith("us") &&
    !k.endsWith("is")
  ) {
    return k.slice(0, -1);
  }
  // Turkish: -lar / -ler plural suffix (kurslar → kurs)
  if (k.length > 4 && (k.endsWith("lar") || k.endsWith("ler"))) {
    return k.slice(0, -3);
  }
  return k;
}

/**
 * Deduplicate keywords by their canonical form, preserving the first
 * occurrence's original surface (so "Tracker" wins over "trackers" if it
 * appeared first in the input order).
 */
export function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Map<string, string>();
  for (const kw of keywords) {
    const canon = canonicalKeyword(kw);
    if (canon && !seen.has(canon)) {
      seen.set(canon, kw);
    }
  }
  return [...seen.values()];
}

/**
 * Extracts keywords from an app's title.
 * Filters out stop words and dedupes plural variants.
 */
export function extractTitleKeywords(title: string): string[] {
  const stopWords = new Set([
    // English grammar
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
    "be", "has", "had", "not", "no", "do", "does", "did", "you", "your",
    "my", "our", "we", "i",
    // Turkish grammar
    "ve", "ile", "bir", "bu", "da", "de", "mi", "mu", "için", "icin",
    "gibi", "olan", "olarak", "den", "dan", "ya", "en", "çok", "cok",
    "var", "yok", "daha", "ama",
    // App Store generic noise (appears in nearly every app title)
    "app", "apps", "uygulama", "pro", "lite", "free", "ücretsiz", "ucretsiz",
    "premium", "plus", "mini", "max", "best", "top", "new", "now",
    "official", "ultimate",
  ]);

  // Unicode-aware split: anything that isn't a letter or number is a separator.
  // This handles Turkish (ç, ğ, ı, ö, ş, ü), CJK characters, and the long tail
  // of App Store title symbols (·, ™, ®, ★, +, parentheses, em/en dashes, etc.)
  // that the previous explicit-character splitter missed.
  const tokens = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !stopWords.has(w));

  return dedupeKeywords(tokens);
}

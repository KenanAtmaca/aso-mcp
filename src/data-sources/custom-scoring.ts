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
 * Extracts keywords from an app's title.
 * Filters out stop words.
 */
export function extractTitleKeywords(title: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
    "be", "has", "had", "not", "no", "do", "does", "did",
    // Turkish stop words
    "ve", "ile", "bir", "bu", "da", "de", "mi", "mu", "için", "gibi",
    "olan", "olarak", "den", "dan", "ya", "en",
    // App Store common
    "-", "&", "|", ":", "/",
  ]);

  return title
    .toLowerCase()
    .split(/[\s\-&|:\/,\.]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !stopWords.has(w));
}

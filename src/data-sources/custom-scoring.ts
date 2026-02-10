/**
 * Custom ASO Scoring Algoritması
 * Apple Search Ads popularity sorununa bağımlı olmadan,
 * kendi hesapladığımız metrikleri sunar.
 */

export interface CustomScore {
  visibilityScore: number;   // 0-10: App'in genel görünürlüğü
  competitiveScore: number;  // 0-10: Rekabet gücü
  opportunityScore: number;  // 0-10: Fırsat skoru (yüksek = iyi fırsat)
  overallScore: number;      // 0-10: Genel ASO skoru
}

export interface KeywordOpportunity {
  keyword: string;
  score: number;
  reason: string;
}

/**
 * Bir app'in ASO metriklerinden visibility skoru hesaplar.
 * Rating, review sayısı, sıralama gibi faktörleri ağırlıklandırır.
 */
export function calculateVisibilityScore(params: {
  rating: number;
  reviewCount: number;
  rankInKeyword?: number;
  totalAppsInKeyword?: number;
}): number {
  const { rating, reviewCount, rankInKeyword, totalAppsInKeyword } = params;

  // Rating katkısı (0-3 puan): 4.5+ = 3, 4.0+ = 2, 3.0+ = 1
  const ratingScore = rating >= 4.5 ? 3 : rating >= 4.0 ? 2 : rating >= 3.0 ? 1 : 0;

  // Review sayısı katkısı (0-3 puan): logaritmik ölçek
  const reviewScore = Math.min(3, Math.log10(Math.max(1, reviewCount)) / 1.5);

  // Sıralama katkısı (0-4 puan)
  let rankScore = 2; // default orta
  if (rankInKeyword !== undefined && totalAppsInKeyword) {
    const percentile = 1 - rankInKeyword / totalAppsInKeyword;
    rankScore = percentile * 4;
  }

  return Math.min(10, ratingScore + reviewScore + rankScore);
}

/**
 * Bir keyword'ün rekabet skorunu hesaplar.
 * Üst sıradaki app'lerin gücüne bakarak zorluğu belirler.
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

  // Yüksek rating = daha zor (0-3)
  const ratingDifficulty = (avgRating / 5) * 3;

  // Çok review = daha zor (0-4, logaritmik)
  const reviewDifficulty = Math.min(4, Math.log10(Math.max(1, avgReviews)) / 1.25);

  // Çoğu ücretsiz = daha zor (0-3)
  const freeDifficulty = freeRatio * 3;

  return Math.min(10, ratingDifficulty + reviewDifficulty + freeDifficulty);
}

/**
 * Keyword fırsat skoru: Yüksek traffic + düşük difficulty = yüksek fırsat
 */
export function calculateOpportunityScore(
  traffic: number,
  difficulty: number
): number {
  if (traffic === 0 && difficulty === 0) return 5;
  // traffic yüksek + difficulty düşük = yüksek skor
  const raw = (traffic * 1.5 - difficulty * 0.8 + 5);
  return Math.max(0, Math.min(10, raw));
}

/**
 * Tüm skorları birleştirip genel bir ASO skoru üretir.
 */
export function calculateOverallScore(params: {
  visibilityScore: number;
  competitiveScore: number;
  opportunityScore: number;
}): number {
  const { visibilityScore, competitiveScore, opportunityScore } = params;
  // Ağırlıklar: visibility %40, opportunity %35, competitive (ters) %25
  const competitiveInverse = 10 - competitiveScore;
  return (
    visibilityScore * 0.4 +
    opportunityScore * 0.35 +
    competitiveInverse * 0.25
  );
}

/**
 * Bir app'in title'ından keyword'leri çıkarır.
 * Stop word'leri filtreler.
 */
export function extractTitleKeywords(title: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
    "be", "has", "had", "not", "no", "do", "does", "did",
    // Türkçe stop words
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

import { withRateLimit } from "../utils/rate-limiter.js";
import { RATE_LIMITS } from "../utils/constants.js";
import { searchApps, getSuggestions } from "./app-store.js";
import { calculateCompetitiveScore } from "./custom-scoring.js";

const RL = RATE_LIMITS["aso-scores"];

let asoModule: any = null;
let asoAvailable = true;
let asoFailedAt = 0;
const ASO_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function getAsoModule(): Promise<any> {
  if (!asoModule) {
    const mod = await import("aso");
    asoModule = mod.default || mod;
  }
  return asoModule;
}

async function getClient(country: string = "tr"): Promise<any> {
  const asoFn = await getAsoModule();
  return asoFn("itunes", { country });
}

/**
 * If the aso package returns 503, calculate our own scores from search results.
 * Traffic: estimated from search result count + average review count
 * Difficulty: calculated from rating/review strength of top-ranking apps
 */
async function fallbackScores(
  keyword: string,
  country: string
): Promise<{ traffic: number; difficulty: number }> {
  const results = await searchApps(keyword, country, 20);

  if (results.length === 0) {
    return { traffic: 1, difficulty: 1 };
  }

  // Traffic estimate: based on result quality
  const avgReviews =
    results.reduce((s: number, a: any) => s + (a.reviews || 0), 0) /
    results.length;
  const traffic = Math.min(
    10,
    Math.max(1, Math.log10(Math.max(1, avgReviews)) * 1.8)
  );

  // Difficulty: competitive score
  const difficulty = calculateCompetitiveScore(
    results.slice(0, 10).map((a: any) => ({
      rating: a.score || 0,
      reviews: a.reviews || 0,
      free: a.free ?? true,
    }))
  );

  return {
    traffic: Math.round(traffic * 10) / 10,
    difficulty: Math.round(difficulty * 10) / 10,
  };
}

export async function getScores(
  keyword: string,
  country: string = "tr"
): Promise<{ traffic: number; difficulty: number }> {
  // If the aso package has previously failed, check if enough time passed to retry
  if (!asoAvailable) {
    if (Date.now() - asoFailedAt < ASO_RETRY_INTERVAL_MS) {
      return fallbackScores(keyword, country);
    }
    // Retry: enough time has passed
    asoAvailable = true;
  }

  return withRateLimit("aso-scores", RL, async () => {
    try {
      const client = await getClient(country);
      const result = await client.scores(keyword);
      return {
        traffic: result.traffic ?? 0,
        difficulty: result.difficulty ?? 0,
      };
    } catch {
      // aso package not working, switch to fallback with timestamp
      asoAvailable = false;
      asoFailedAt = Date.now();
      return fallbackScores(keyword, country);
    }
  });
}

export async function suggestKeywords(
  appId: string,
  strategy: "category" | "similar" | "competition",
  country: string = "tr",
  num: number = 20
): Promise<string[]> {
  // If aso package unavailable, check if enough time passed to retry
  if (!asoAvailable) {
    if (Date.now() - asoFailedAt < ASO_RETRY_INTERVAL_MS) {
      return fallbackSuggest(appId, strategy, country, num);
    }
    asoAvailable = true;
  }

  return withRateLimit("aso-scores", RL, async () => {
    try {
      const client = await getClient(country);

      const strategyMap: Record<string, any> = {
        category: client.CATEGORY,
        similar: client.SIMILAR,
        competition: client.COMPETITION,
      };

      return await client.suggest({
        strategy: strategyMap[strategy],
        appId,
        num,
      });
    } catch {
      asoAvailable = false;
      asoFailedAt = Date.now();
      return fallbackSuggest(appId, strategy, country, num);
    }
  });
}

/**
 * Score multiple keywords in parallel with a concurrency limit.
 * Returns results in the same order as input keywords.
 */
export async function batchGetScores(
  keywords: string[],
  country: string = "tr",
  concurrency: number = 5
): Promise<{ keyword: string; traffic: number; difficulty: number }[]> {
  const results: { keyword: string; traffic: number; difficulty: number }[] = [];

  for (let i = 0; i < keywords.length; i += concurrency) {
    const batch = keywords.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (kw) => {
        try {
          const scores = await getScores(kw, country);
          return { keyword: kw, traffic: scores.traffic, difficulty: scores.difficulty };
        } catch {
          return { keyword: kw, traffic: 0, difficulty: 0 };
        }
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * When the aso package is unavailable, generate keyword suggestions via app-store-scraper.
 * Sends keywords from the app's title + description to App Store suggest.
 */
async function fallbackSuggest(
  appId: string,
  _strategy: string,
  country: string,
  num: number
): Promise<string[]> {
  try {
    // App Store autocomplete suggestions
    const suggestions = await getSuggestions(appId);
    if (suggestions.length >= num) {
      return suggestions.slice(0, num);
    }

    // Additionally pull suggestions from simple keywords
    const extraTerms = appId.split(/[.\-_]/).filter((t) => t.length > 2);
    const allSuggestions = new Set(suggestions);

    for (const term of extraTerms.slice(0, 3)) {
      try {
        const more = await getSuggestions(term);
        more.forEach((s: string) => allSuggestions.add(s));
      } catch {
        // continue
      }
    }

    return [...allSuggestions].slice(0, num);
  } catch {
    return [];
  }
}

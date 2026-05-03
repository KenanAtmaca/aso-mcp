import { withRateLimit } from "../utils/rate-limiter.js";
import { RATE_LIMITS } from "../utils/constants.js";
import { searchApps, getSuggestions, getAppDetails } from "./app-store.js";
import {
  calculateCompetitiveScore,
  extractTitleKeywords,
} from "./custom-scoring.js";

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
 * Traffic uses three independent signals so a single noisy data point
 * (e.g. one blockbuster app) cannot dominate the estimate:
 *   1) Result count: how many apps Apple returns for the term (popular = many)
 *   2) Top result strength: blockbuster apps cluster around high-traffic terms
 *   3) Average review depth: many established apps signals broad interest
 * Difficulty is calculated from rating/review strength of top-ranking apps.
 */
async function fallbackScores(
  keyword: string,
  country: string
): Promise<{ traffic: number; difficulty: number }> {
  const results = await searchApps(keyword, country, 20);

  if (results.length === 0) {
    return { traffic: 1, difficulty: 1 };
  }

  const top1Reviews = (results[0] as any)?.reviews || 0;
  const avgReviews =
    results.reduce((s: number, a: any) => s + (a.reviews || 0), 0) /
    results.length;

  // Signal 1: result count (0-3). Apple caps responses around 20+ for popular terms.
  const resultCountSignal = Math.min(3, results.length / 6.67);

  // Signal 2: top result review depth (0-4). 1M+ review apps mark high-traffic terms.
  const top1Signal = Math.min(4, Math.log10(Math.max(1, top1Reviews)) / 1.5);

  // Signal 3: average review depth across results (0-3).
  const avgSignal = Math.min(3, Math.log10(Math.max(1, avgReviews)) / 1.8);

  const traffic = Math.min(
    10,
    Math.max(1, resultCountSignal + top1Signal + avgSignal)
  );

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

  // Let withRateLimit's exponential backoff retry handle transient 503/429
  // before we give up and switch to fallback for the full retry interval.
  try {
    return await withRateLimit("aso-scores", RL, async () => {
      const client = await getClient(country);
      const result = await client.scores(keyword);
      return {
        traffic: result.traffic ?? 0,
        difficulty: result.difficulty ?? 0,
      };
    });
  } catch {
    asoAvailable = false;
    asoFailedAt = Date.now();
    return fallbackScores(keyword, country);
  }
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

  try {
    return await withRateLimit("aso-scores", RL, async () => {
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
    });
  } catch {
    asoAvailable = false;
    asoFailedAt = Date.now();
    return fallbackSuggest(appId, strategy, country, num);
  }
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
 * Fetches the app's actual title and seeds App Store autocomplete with each
 * meaningful title keyword. Bundle IDs ('com.spotify.client') alone are
 * useless to autocomplete, so we always resolve the app first.
 */
async function fallbackSuggest(
  appId: string,
  _strategy: string,
  country: string,
  num: number
): Promise<string[]> {
  try {
    // Resolve the app to get its real title (works for both bundle ID and numeric ID)
    const app = await getAppDetails(appId, country);
    const titleKeywords = extractTitleKeywords(app.title || "");

    if (titleKeywords.length === 0) {
      return [];
    }

    const allSuggestions = new Set<string>();

    // Seed autocomplete with the full title (catches multi-word brand suggestions)
    try {
      const titleSuggestions = await getSuggestions(app.title);
      titleSuggestions.forEach((s: string) => allSuggestions.add(s));
    } catch {
      // continue
    }

    // Then seed with each meaningful title keyword
    for (const term of titleKeywords.slice(0, 3)) {
      if (allSuggestions.size >= num) break;
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

import { withRateLimit } from "../utils/rate-limiter.js";
import { RATE_LIMITS } from "../utils/constants.js";
import { searchApps, getSuggestions } from "./app-store.js";
import { calculateCompetitiveScore } from "./custom-scoring.js";

const RL = RATE_LIMITS["aso-scores"];

let asoModule: any = null;
let asoAvailable = true;

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
 * aso paketi 503 veriyorsa, search sonuçlarından kendi skorumuzu hesapla.
 * Traffic: arama sonucu sayısı + ortalama review sayısından tahmin
 * Difficulty: üst sıradaki app'lerin rating/review gücünden hesapla
 */
async function fallbackScores(
  keyword: string,
  country: string
): Promise<{ traffic: number; difficulty: number }> {
  const results = await searchApps(keyword, country, 20);

  if (results.length === 0) {
    return { traffic: 1, difficulty: 1 };
  }

  // Traffic tahmini: sonuç kalitesine göre
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
  // aso paketi daha önce başarısız olduysa direkt fallback
  if (!asoAvailable) {
    return fallbackScores(keyword, country);
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
      // aso paketi çalışmıyor, fallback'e geç
      asoAvailable = false;
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
  // aso paketi yoksa App Store suggest + search bazlı fallback
  if (!asoAvailable) {
    return fallbackSuggest(appId, strategy, country, num);
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
      return fallbackSuggest(appId, strategy, country, num);
    }
  });
}

/**
 * aso paketi çalışmadığında, app-store-scraper ile keyword önerisi üret.
 * App'in title + description'ındaki keyword'leri App Store suggest'e gönderir.
 */
async function fallbackSuggest(
  appId: string,
  _strategy: string,
  country: string,
  num: number
): Promise<string[]> {
  try {
    // App Store autocomplete önerileri
    const suggestions = await getSuggestions(appId);
    if (suggestions.length >= num) {
      return suggestions.slice(0, num);
    }

    // Ek olarak basit keyword'lerden suggest çek
    const extraTerms = appId.split(/[.\-_]/).filter((t) => t.length > 2);
    const allSuggestions = new Set(suggestions);

    for (const term of extraTerms.slice(0, 3)) {
      try {
        const more = await getSuggestions(term);
        more.forEach((s: string) => allSuggestions.add(s));
      } catch {
        // devam
      }
    }

    return [...allSuggestions].slice(0, num);
  } catch {
    return [];
  }
}

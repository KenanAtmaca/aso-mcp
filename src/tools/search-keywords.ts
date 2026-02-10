import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getScores } from "../data-sources/aso-scoring.js";
import { searchApps } from "../data-sources/app-store.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import {
  formatCompetitionLevel,
  formatTrafficLevel,
  generateRecommendation,
} from "../utils/formatters.js";

export function registerSearchKeywords(server: McpServer) {
  server.tool(
    "search_keywords",
    "Bir keyword icin App Store'daki traffic skoru, difficulty skoru ve rakip app'leri analiz eder. ASO keyword arastirmasi icin temel tool.",
    {
      keyword: z
        .string()
        .describe("Arastirilacak keyword (or: 'fitness tracker', 'yapay zeka')"),
      country: z
        .string()
        .default("tr")
        .describe("Ulke kodu (tr, us, de, gb, fr...)"),
      num: z
        .number()
        .default(10)
        .describe("Gosterilecek rakip app sayisi"),
    },
    async ({ keyword, country, num }) => {
      const cacheKey = `search:${keyword}:${country}:${num}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const [scores, topApps] = await Promise.all([
          getScores(keyword, country),
          searchApps(keyword, country, num),
        ]);

        const result = {
          keyword,
          country,
          scores: {
            traffic: scores.traffic,
            difficulty: scores.difficulty,
          },
          topApps: topApps.map((app: any) => ({
            title: app.title,
            developer: app.developer,
            rating: app.score,
            reviews: app.reviews,
            free: app.free,
            price: app.price,
            url: app.url,
          })),
          analysis: {
            competitionLevel: formatCompetitionLevel(scores.difficulty),
            trafficLevel: formatTrafficLevel(scores.traffic),
            recommendation: generateRecommendation(scores),
          },
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.KEYWORD_SCORES);

        return { content: [{ type: "text" as const, text: resultText }] };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Hata: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}

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
    "Analyzes traffic score, difficulty score and competitor apps for a keyword on the App Store. The fundamental tool for ASO keyword research.",
    {
      keyword: z
        .string()
        .describe("Keyword to research (e.g. 'fitness tracker', 'photo editor')"),
      country: z
        .string()
        .default("tr")
        .describe("Country code (tr, us, de, gb, fr...)"),
      num: z
        .number()
        .default(10)
        .describe("Number of competitor apps to show"),
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
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}

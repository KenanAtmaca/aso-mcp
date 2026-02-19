import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { batchGetScores } from "../data-sources/aso-scoring.js";
import { searchApps } from "../data-sources/app-store.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import { getCountryName } from "../utils/localization.js";

export function registerLocalizedKeywords(server: McpServer) {
  server.tool(
    "localized_keywords",
    "Adapts a set of keywords to different markets. Retrieves keyword scores (traffic/difficulty) for each country and shows top-ranking apps in each market. Used for multi-country ASO strategy.",
    {
      keywords: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe("List of keywords to analyze"),
      sourceCountry: z
        .string()
        .min(2)
        .max(5)
        .default("tr")
        .describe("Source country code"),
      targetCountries: z
        .array(z.string().min(2).max(5))
        .min(1)
        .max(10)
        .describe("Target country codes (e.g. ['us', 'de', 'gb', 'fr'])"),
    },
    async ({ keywords, sourceCountry, targetCountries }) => {
      const allCountries = [
        sourceCountry,
        ...targetCountries.filter((c) => c !== sourceCountry),
      ];
      const cacheKey = `localized:${keywords.join(",")}:${allCountries.join(",")}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const localizations: {
          country: string;
          countryName: string;
          keywords: {
            keyword: string;
            traffic: number;
            difficulty: number;
            topApp: string;
          }[];
          bestKeyword: string | null;
          avgTraffic: number;
        }[] = [];

        const limitedKeywords = keywords.slice(0, 15);

        // Process all countries in parallel
        const countryResults = await Promise.all(
          allCountries.map(async (country) => {
            // Batch score all keywords for this country
            const scores = await batchGetScores(limitedKeywords, country);
            const scoreMap = new Map(scores.map((s) => [s.keyword, s]));

            // Get top apps for each keyword (parallel within country)
            const topAppResults = await Promise.all(
              limitedKeywords.map(async (keyword) => {
                try {
                  const apps = await searchApps(keyword, country, 1);
                  return { keyword, topApp: (apps[0] as any)?.title || "" };
                } catch {
                  return { keyword, topApp: "" };
                }
              })
            );
            const topAppMap = new Map(topAppResults.map((r) => [r.keyword, r.topApp]));

            const kwResults = limitedKeywords.map((keyword) => {
              const s = scoreMap.get(keyword) || { traffic: 0, difficulty: 0 };
              return {
                keyword,
                traffic: s.traffic,
                difficulty: s.difficulty,
                topApp: topAppMap.get(keyword) || "",
              };
            });

            const avgTraffic =
              kwResults.length > 0
                ? kwResults.reduce((s, k) => s + k.traffic, 0) / kwResults.length
                : 0;

            const best = [...kwResults].sort(
              (a, b) => b.traffic - a.traffic || a.difficulty - b.difficulty
            )[0];

            return {
              country,
              countryName: getCountryName(country),
              keywords: kwResults,
              bestKeyword: best?.keyword || null,
              avgTraffic: Math.round(avgTraffic * 10) / 10,
            };
          })
        );

        localizations.push(...countryResults);

        // Sort countries by average traffic
        localizations.sort((a, b) => b.avgTraffic - a.avgTraffic);

        // Keyword-based cross-country comparison
        const crossCountry: Record<
          string,
          { country: string; traffic: number; difficulty: number }[]
        > = {};
        for (const kw of keywords.slice(0, 15)) {
          crossCountry[kw] = localizations.map((loc) => {
            const kwData = loc.keywords.find((k) => k.keyword === kw);
            return {
              country: loc.country,
              traffic: kwData?.traffic ?? 0,
              difficulty: kwData?.difficulty ?? 0,
            };
          });
        }

        const result = {
          sourceCountry,
          targetCountries,
          totalKeywords: keywords.length,
          localizations,
          crossCountryComparison: crossCountry,
          bestMarket: localizations[0]?.country || sourceCountry,
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

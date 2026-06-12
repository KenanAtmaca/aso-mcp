import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { suggestKeywords, batchGetScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import { calculateOpportunityScore } from "../data-sources/custom-scoring.js";
import {
  isHighOpportunity,
  scoresCacheTtl,
  scoresSourceNote,
  summarizeScoresSource,
} from "../utils/formatters.js";

export function registerSuggestKeywords(server: McpServer) {
  server.tool(
    "suggest_keywords",
    "Generates keyword suggestions using different strategies for a given app ID. Provides category-based, similar apps-based, or competition-based keyword recommendations.",
    {
      appId: z
        .string()
        .min(1)
        .describe("App Store app ID (e.g. 'com.spotify.client' or '324684580')"),
      strategy: z
        .enum(["category", "similar", "competition", "all"])
        .default("all")
        .describe("Keyword suggestion strategy"),
      country: z
        .string()
        .min(2)
        .max(5)
        .default("tr")
        .describe("Country code (tr, us, de, gb, fr...)"),
      num: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .describe("Number of keywords to suggest per strategy"),
    },
    async ({ appId, strategy, country, num }) => {
      const cacheKey = `suggest:${appId.trim().toLowerCase()}:${strategy}:${country.toLowerCase()}:${num}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const strategies =
          strategy === "all"
            ? (["category", "similar", "competition"] as const)
            : ([strategy] as const);

        // Run all strategies in parallel
        const strategyResults = await Promise.all(
          strategies.map(async (s) => {
            try {
              const keywords = await suggestKeywords(appId, s, country, num);
              return { strategy: s, keywords };
            } catch {
              return { strategy: s, keywords: [] as string[] };
            }
          })
        );

        const allKeywords: Record<string, string[]> = {};
        for (const r of strategyResults) {
          allKeywords[r.strategy] = r.keywords;
        }

        // Get scores for unique keywords (in parallel)
        const uniqueKeywords = [
          ...new Set(Object.values(allKeywords).flat()),
        ];

        const SCORE_LIMIT = 30;
        const scoredKeywords = await batchGetScores(
          uniqueKeywords.slice(0, SCORE_LIMIT),
          country
        );
        const truncationNote =
          uniqueKeywords.length > SCORE_LIMIT
            ? `Scored the first ${SCORE_LIMIT} of ${uniqueKeywords.length} unique keywords. The rest are listed unscored under 'strategies'.`
            : undefined;

        // Sort by traffic
        scoredKeywords.sort((a, b) => b.traffic - a.traffic);

        const scoresSource = summarizeScoresSource(scoredKeywords);

        const result = {
          appId,
          country,
          scoresSource,
          scoresNote: scoresSourceNote(scoresSource),
          truncationNote,
          strategies: allKeywords,
          scoredKeywords,
          totalUniqueKeywords: uniqueKeywords.length,
          scoredKeywordsCount: scoredKeywords.length,
          topOpportunities: scoredKeywords
            .filter((k) =>
              isHighOpportunity(
                calculateOpportunityScore(k.traffic, k.difficulty)
              )
            )
            .slice(0, 10),
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(
          cacheKey,
          resultText,
          scoresCacheTtl(CACHE_TTL.SUGGESTIONS, scoresSource)
        );

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

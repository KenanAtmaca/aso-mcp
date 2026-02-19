import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAppDetails, searchApps } from "../data-sources/app-store.js";
import { batchGetScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import {
  extractTitleKeywords,
  calculateOpportunityScore,
} from "../data-sources/custom-scoring.js";

export function registerKeywordGap(server: McpServer) {
  server.tool(
    "keyword_gap",
    "Analyzes the keyword difference between two apps. Shows which keywords are unique to each app and which are shared. Identifies opportunity keywords.",
    {
      appId1: z
        .string()
        .min(1)
        .describe("First app ID or bundle ID"),
      appId2: z
        .string()
        .min(1)
        .describe("Second app ID or bundle ID"),
      country: z
        .string()
        .min(2)
        .max(5)
        .default("tr")
        .describe("Country code"),
    },
    async ({ appId1, appId2, country }) => {
      const cacheKey = `gap:${appId1}:${appId2}:${country}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        // Get details for both apps
        const [app1, app2] = await Promise.all([
          getAppDetails(appId1, country),
          getAppDetails(appId2, country),
        ]);

        // Extract keywords: title + description
        const extractAllKeywords = (app: any): string[] => {
          const titleKws = extractTitleKeywords(app.title || "");
          const descKws = extractTitleKeywords(
            (app.description || "").slice(0, 500)
          );
          return [...new Set([...titleKws, ...descKws])];
        };

        const keywords1 = extractAllKeywords(app1);
        const keywords2 = extractAllKeywords(app2);

        const set1 = new Set(keywords1);
        const set2 = new Set(keywords2);

        const onlyApp1 = keywords1.filter((kw) => !set2.has(kw));
        const onlyApp2 = keywords2.filter((kw) => !set1.has(kw));
        const shared = keywords1.filter((kw) => set2.has(kw));

        // Score all unique keywords in batch (parallel)
        const allUniqueKws = [
          ...onlyApp2.slice(0, 15).map((kw) => ({ kw, source: `Unique to ${app2.title}` })),
          ...onlyApp1.slice(0, 15).map((kw) => ({ kw, source: `Unique to ${app1.title}` })),
        ];

        const batchScores = await batchGetScores(
          allUniqueKws.map((item) => item.kw),
          country
        );
        const scoreMap = new Map(batchScores.map((s) => [s.keyword, s]));

        const opportunities = allUniqueKws.map((item) => {
          const scores = scoreMap.get(item.kw) || { traffic: 0, difficulty: 0 };
          return {
            keyword: item.kw,
            traffic: scores.traffic,
            difficulty: scores.difficulty,
            opportunityScore: calculateOpportunityScore(
              scores.traffic,
              scores.difficulty
            ),
            source: item.source,
          };
        });

        opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);

        const result = {
          app1: {
            appId: appId1,
            title: app1.title,
            totalKeywords: keywords1.length,
          },
          app2: {
            appId: appId2,
            title: app2.title,
            totalKeywords: keywords2.length,
          },
          country,
          comparison: {
            onlyApp1,
            onlyApp2,
            shared,
            overlapPercentage: shared.length > 0
              ? Math.round(
                  (shared.length /
                    new Set([...keywords1, ...keywords2]).size) *
                    100
                )
              : 0,
          },
          opportunities: opportunities.slice(0, 20),
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.SEARCH_RESULTS);

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

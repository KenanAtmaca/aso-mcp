import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAppDetails, searchApps } from "../data-sources/app-store.js";
import { getScores } from "../data-sources/aso-scoring.js";
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
        .describe("First app ID or bundle ID"),
      appId2: z
        .string()
        .describe("Second app ID or bundle ID"),
      country: z
        .string()
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

        // Opportunity keywords: in app2 but not in app1, with high traffic
        const opportunities: {
          keyword: string;
          traffic: number;
          difficulty: number;
          opportunityScore: number;
          source: string;
        }[] = [];

        // Opportunities for app1 (in app2 but not in app1)
        for (const kw of onlyApp2.slice(0, 15)) {
          try {
            const scores = await getScores(kw, country);
            opportunities.push({
              keyword: kw,
              traffic: scores.traffic,
              difficulty: scores.difficulty,
              opportunityScore: calculateOpportunityScore(
                scores.traffic,
                scores.difficulty
              ),
              source: `Unique to ${app2.title}`,
            });
          } catch {
            // continue
          }
        }

        // Opportunities for app2 (in app1 but not in app2)
        for (const kw of onlyApp1.slice(0, 15)) {
          try {
            const scores = await getScores(kw, country);
            opportunities.push({
              keyword: kw,
              traffic: scores.traffic,
              difficulty: scores.difficulty,
              opportunityScore: calculateOpportunityScore(
                scores.traffic,
                scores.difficulty
              ),
              source: `Unique to ${app1.title}`,
            });
          } catch {
            // continue
          }
        }

        // Sort opportunities by score
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

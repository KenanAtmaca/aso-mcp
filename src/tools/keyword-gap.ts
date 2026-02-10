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
    "Iki uygulama arasindaki keyword farkini analiz eder. Hangi keyword'ler sadece birinde var, hangileri ortaksa gosterir. Firsat keyword'lerini belirler.",
    {
      appId1: z
        .string()
        .describe("Birinci app ID veya bundle ID"),
      appId2: z
        .string()
        .describe("Ikinci app ID veya bundle ID"),
      country: z
        .string()
        .default("tr")
        .describe("Ulke kodu"),
    },
    async ({ appId1, appId2, country }) => {
      const cacheKey = `gap:${appId1}:${appId2}:${country}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        // Her iki app'in detaylarını al
        const [app1, app2] = await Promise.all([
          getAppDetails(appId1, country),
          getAppDetails(appId2, country),
        ]);

        // Keyword'leri çıkar: title + description
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

        // Fırsat keyword'leri: app2'de olup app1'de olmayan ve yüksek traffic'li
        const opportunities: {
          keyword: string;
          traffic: number;
          difficulty: number;
          opportunityScore: number;
          source: string;
        }[] = [];

        // App1 için fırsatlar (app2'de olup app1'de olmayan)
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
              source: `${app2.title} icin benzersiz`,
            });
          } catch {
            // devam
          }
        }

        // App2 için fırsatlar (app1'de olup app2'de olmayan)
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
              source: `${app1.title} icin benzersiz`,
            });
          } catch {
            // devam
          }
        }

        // Fırsatları skora göre sırala
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
          content: [{ type: "text" as const, text: `Hata: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}

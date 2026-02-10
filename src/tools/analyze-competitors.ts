import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchApps } from "../data-sources/app-store.js";
import { getScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import {
  calculateCompetitiveScore,
  extractTitleKeywords,
} from "../data-sources/custom-scoring.js";

export function registerAnalyzeCompetitors(server: McpServer) {
  server.tool(
    "analyze_competitors",
    "Bir keyword'de ust siradaki uygulamalarin metadata'sini ceker, karsilastirir ve keyword gap analizi yapar. Rekabet ortamini anlamak icin kullanilir.",
    {
      keyword: z.string().describe("Analiz edilecek keyword"),
      country: z
        .string()
        .default("tr")
        .describe("Ulke kodu (tr, us, de, gb, fr...)"),
      num: z
        .number()
        .default(10)
        .describe("Analiz edilecek rakip app sayisi"),
    },
    async ({ keyword, country, num }) => {
      const cacheKey = `competitors:${keyword}:${country}:${num}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const topApps = await searchApps(keyword, country, num);

        // Her app'in title keyword'lerini çıkar
        const appsWithKeywords = topApps.map((app: any) => {
          const titleKeywords = extractTitleKeywords(app.title || "");
          return {
            title: app.title,
            developer: app.developer,
            rating: app.score || 0,
            reviews: app.reviews || 0,
            free: app.free,
            price: app.price || 0,
            url: app.url,
            titleKeywords,
          };
        });

        // Keyword frequency analizi
        const keywordFrequency: Record<string, number> = {};
        for (const app of appsWithKeywords) {
          for (const kw of app.titleKeywords) {
            keywordFrequency[kw] = (keywordFrequency[kw] || 0) + 1;
          }
        }

        // Common keywords (2+ app'te geçen)
        const commonKeywords = Object.entries(keywordFrequency)
          .filter(([, count]) => count >= 2)
          .sort((a, b) => b[1] - a[1])
          .map(([kw]) => kw);

        // Tüm benzersiz keyword'ler
        const allKeywords = [...new Set(
          appsWithKeywords.flatMap((a) => a.titleKeywords)
        )];

        // Keyword gap: commonKeywords'de olmayan keyword'ler (fırsat)
        const commonSet = new Set(commonKeywords);
        const keywordGap = allKeywords.filter((kw) => !commonSet.has(kw));

        // Metrikler
        const avgRating =
          appsWithKeywords.reduce((s, a) => s + a.rating, 0) /
          appsWithKeywords.length;
        const avgReviews =
          appsWithKeywords.reduce((s, a) => s + a.reviews, 0) /
          appsWithKeywords.length;
        const freePercentage =
          (appsWithKeywords.filter((a) => a.free).length /
            appsWithKeywords.length) *
          100;

        // Top developer'lar
        const devFrequency: Record<string, number> = {};
        for (const app of appsWithKeywords) {
          devFrequency[app.developer] = (devFrequency[app.developer] || 0) + 1;
        }
        const topDevelopers = Object.entries(devFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([dev]) => dev);

        // Competitive score
        const competitiveScore = calculateCompetitiveScore(appsWithKeywords);

        // Ana keyword skoru
        let keywordScores = { traffic: 0, difficulty: 0 };
        try {
          keywordScores = await getScores(keyword, country);
        } catch {
          // scoring alınamazsa devam
        }

        const result = {
          keyword,
          country,
          competitiveScore: Math.round(competitiveScore * 10) / 10,
          keywordScores,
          apps: appsWithKeywords,
          commonKeywords,
          keywordGap,
          metrics: {
            avgRating: Math.round(avgRating * 100) / 100,
            avgReviews: Math.round(avgReviews),
            freePercentage: Math.round(freePercentage),
            topDevelopers,
            totalAppsAnalyzed: appsWithKeywords.length,
          },
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

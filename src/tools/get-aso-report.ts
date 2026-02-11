import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAppDetails,
  searchApps,
  getReviews,
  getSimilarApps,
} from "../data-sources/app-store.js";
import { batchGetScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL, CHAR_LIMITS } from "../utils/constants.js";
import {
  extractTitleKeywords,
  calculateVisibilityScore,
  calculateCompetitiveScore,
  calculateOpportunityScore,
  calculateOverallScore,
} from "../data-sources/custom-scoring.js";

export function registerGetAsoReport(server: McpServer) {
  server.tool(
    "get_aso_report",
    "Generates a comprehensive ASO report for an app. Gathers app details, keyword scores, competitor analysis, review summary, and metadata status in one call. The ideal tool for AI to perform in-depth ASO analysis.",
    {
      appId: z
        .string()
        .describe("App Store app ID or bundle ID"),
      country: z
        .string()
        .default("tr")
        .describe("Country code"),
      competitors: z
        .number()
        .default(5)
        .describe("Number of competitors to analyze"),
    },
    async ({ appId, country, competitors }) => {
      const cacheKey = `report:${appId}:${country}:${competitors}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        // 1. App details
        const app = await getAppDetails(appId, country);
        const titleKeywords = extractTitleKeywords(app.title || "");

        // 2. Title keyword scores (in parallel)
        const keywordScores = await batchGetScores(
          titleKeywords.slice(0, 10),
          country
        );

        // 3. Search by app name — competitors
        let competitorApps: any[] = [];
        try {
          competitorApps = await searchApps(
            app.title?.split(/[-:|]/)[0]?.trim() || appId,
            country,
            competitors + 1
          );
          // Remove self
          competitorApps = competitorApps.filter(
            (a: any) => a.id !== app.id && a.appId !== app.appId
          ).slice(0, competitors);
        } catch {
          // continue
        }

        // 4. Similar apps
        let similarApps: any[] = [];
        try {
          similarApps = (await getSimilarApps(app.id, country)).slice(0, 5);
        } catch {
          // continue
        }

        // 5. Review summary
        let reviewSummary = {
          total: 0,
          positive: 0,
          negative: 0,
          neutral: 0,
          sampleComplaints: [] as string[],
        };
        try {
          const reviews = await getReviews(app.id, country, 1);
          reviewSummary.total = reviews.length;
          for (const r of reviews) {
            const score = r.score || r.rating || 3;
            if (score >= 4) reviewSummary.positive++;
            else if (score <= 2) reviewSummary.negative++;
            else reviewSummary.neutral++;

            if (score <= 2 && reviewSummary.sampleComplaints.length < 3) {
              const text = (r.text || r.body || "").slice(0, 120);
              if (text) reviewSummary.sampleComplaints.push(text);
            }
          }
        } catch {
          // continue
        }

        // 6. Scores
        const visibilityScore = calculateVisibilityScore({
          rating: app.score || 0,
          reviewCount: app.reviews || 0,
        });

        const competitiveScore = calculateCompetitiveScore(
          competitorApps.map((a: any) => ({
            rating: a.score || 0,
            reviews: a.reviews || 0,
            free: a.free ?? true,
          }))
        );

        const avgTraffic =
          keywordScores.length > 0
            ? keywordScores.reduce((s, k) => s + k.traffic, 0) /
              keywordScores.length
            : 0;
        const avgDifficulty =
          keywordScores.length > 0
            ? keywordScores.reduce((s, k) => s + k.difficulty, 0) /
              keywordScores.length
            : 0;

        const opportunityScore = calculateOpportunityScore(
          avgTraffic,
          avgDifficulty
        );

        const overallScore = calculateOverallScore({
          visibilityScore,
          competitiveScore,
          opportunityScore,
        });

        // 7. Metadata analysis
        const titleLength = (app.title || "").length;
        const competitorKeywords = [
          ...new Set(
            competitorApps.flatMap((a: any) =>
              extractTitleKeywords(a.title || "")
            )
          ),
        ];
        const missingKeywords = competitorKeywords.filter(
          (kw) => !titleKeywords.includes(kw)
        );

        const result = {
          app: {
            id: app.id,
            appId: app.appId,
            title: app.title,
            developer: app.developer,
            rating: app.score,
            reviews: app.reviews,
            price: app.price,
            free: app.free,
            genre: app.genre,
            url: app.url,
            icon: app.icon,
            version: app.version,
            updated: app.updated,
            description: (app.description || "").slice(0, 500),
          },
          scores: {
            overall: Math.round(overallScore * 10) / 10,
            visibility: Math.round(visibilityScore * 10) / 10,
            competitive: Math.round(competitiveScore * 10) / 10,
            opportunity: Math.round(opportunityScore * 10) / 10,
          },
          metadata: {
            titleLength,
            titleLimit: CHAR_LIMITS.TITLE,
            titleRemaining: CHAR_LIMITS.TITLE - titleLength,
            titleKeywords,
            missingCompetitorKeywords: missingKeywords.slice(0, 10),
          },
          keywordAnalysis: keywordScores,
          competitors: competitorApps.slice(0, competitors).map((a: any) => ({
            title: a.title,
            developer: a.developer,
            rating: a.score || 0,
            reviews: a.reviews || 0,
            free: a.free,
            titleKeywords: extractTitleKeywords(a.title || ""),
          })),
          similarApps: similarApps.map((a: any) => ({
            title: a.title,
            developer: a.developer,
            rating: a.score || 0,
          })),
          reviews: reviewSummary,
          country,
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.APP_DETAILS);

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

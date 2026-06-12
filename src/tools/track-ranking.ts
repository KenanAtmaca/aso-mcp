import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchApps } from "../data-sources/app-store.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";

export function registerTrackRanking(server: McpServer) {
  server.tool(
    "track_ranking",
    "Finds an app's ranking position for specific keywords. Shows the app's position within the top 100 results for each keyword.",
    {
      appId: z
        .string()
        .min(1)
        .describe("App Store app ID or bundle ID (e.g. 'com.spotify.client')"),
      keywords: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe("List of keywords to track (max 20)"),
      country: z
        .string()
        .min(2)
        .max(5)
        .default("tr")
        .describe("Country code"),
    },
    async ({ appId, keywords, country }) => {
      const keywordsHash = [...keywords]
        .map((k) => k.trim().toLowerCase())
        .sort()
        .join(",");
      const cacheKey = `ranking:${appId.trim().toLowerCase()}:${keywordsHash}:${country.toLowerCase()}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const normalizedBundleId = appId.toLowerCase();
        const numericAppId = /^\d+$/.test(appId) ? appId : null;

        // Keywords run in parallel; the rate limiter queues the actual
        // requests, so this is safe and much faster than a sequential loop.
        const rankings = await Promise.all(
          keywords.map(async (keyword) => {
            try {
              const results = await searchApps(keyword, country, 100);

              // Find the app's position (match by bundle ID or numeric track ID)
              let position: number | null = null;
              for (let i = 0; i < results.length; i++) {
                const result = results[i] as any;
                const resultBundleId = (result.appId || "").toLowerCase();
                const resultId = String(result.id || "");
                const bundleMatch =
                  !!resultBundleId && resultBundleId === normalizedBundleId;
                const idMatch = !!numericAppId && resultId === numericAppId;
                if (bundleMatch || idMatch) {
                  position = i + 1;
                  break;
                }
              }

              const topResult = results[0] as any;
              return {
                keyword,
                position,
                topApp: topResult?.title || "Unknown",
                totalResults: results.length,
              };
            } catch {
              return {
                keyword,
                position: null,
                topApp: "Error",
                totalResults: 0,
              };
            }
          })
        );

        // Summary
        const found = rankings.filter((r) => r.position !== null);
        const top10 = found.filter((r) => r.position! <= 10);
        const top50 = found.filter((r) => r.position! <= 50);

        const result = {
          appId,
          country,
          totalKeywords: keywords.length,
          rankings,
          summary: {
            rankedKeywords: found.length,
            notRanked: rankings.length - found.length,
            top10Count: top10.length,
            top50Count: top50.length,
            bestPosition: found.length > 0
              ? Math.min(...found.map((r) => r.position!))
              : null,
            bestKeyword: found.length > 0
              ? found.sort((a, b) => a.position! - b.position!)[0].keyword
              : null,
          },
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAppDetails, getSimilarApps } from "../data-sources/app-store.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL, CHAR_LIMITS } from "../utils/constants.js";

export function registerGetAppDetails(server: McpServer) {
  server.tool(
    "get_app_details",
    "Tek bir uygulamanin tum ASO-relevant bilgilerini getirir: baslik, aciklama, rating, yorumlar, benzer uygulamalar ve metadata analizi.",
    {
      appId: z
        .string()
        .describe(
          "App Store app ID veya bundle ID (or: '324684580' veya 'com.spotify.client')"
        ),
      country: z
        .string()
        .default("tr")
        .describe("Ulke kodu (tr, us, de, gb, fr...)"),
      includeSimilar: z
        .boolean()
        .default(true)
        .describe("Benzer uygulamalari da getir"),
    },
    async ({ appId, country, includeSimilar }) => {
      const cacheKey = `app:${appId}:${country}:${includeSimilar}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const app = await getAppDetails(appId, country);

        let similarApps: any[] = [];
        if (includeSimilar && app.id) {
          try {
            similarApps = await getSimilarApps(app.id, country);
          } catch {
            // Benzer app'ler alinamazsa devam et
          }
        }

        const titleLength = (app.title || "").length;
        const descriptionWords = (app.description || "")
          .split(/\s+/)
          .filter(Boolean).length;

        const result = {
          app: {
            id: app.id,
            appId: app.appId,
            title: app.title,
            url: app.url,
            description: app.description,
            developer: app.developer,
            developerId: app.developerId,
            score: app.score,
            reviews: app.reviews,
            ratings: app.ratings,
            histogram: app.histogram,
            price: app.price,
            free: app.free,
            currency: app.currency,
            genre: app.genre,
            genreId: app.genreId,
            icon: app.icon,
            released: app.released,
            updated: app.updated,
            version: app.version,
            size: app.size,
          },
          metadataAnalysis: {
            titleLength,
            titleLimitRemaining: CHAR_LIMITS.TITLE - titleLength,
            titleOptimal: titleLength <= CHAR_LIMITS.TITLE,
            descriptionWordCount: descriptionWords,
          },
          similarApps: similarApps.slice(0, 10).map((s: any) => ({
            title: s.title,
            developer: s.developer,
            rating: s.score,
            reviews: s.reviews,
            url: s.url,
          })),
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.APP_DETAILS);

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

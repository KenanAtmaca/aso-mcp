import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { suggestKeywords } from "../data-sources/aso-scoring.js";
import { getScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";

export function registerSuggestKeywords(server: McpServer) {
  server.tool(
    "suggest_keywords",
    "Bir app ID verildiginde farkli stratejilerle keyword onerisi uretir. Kategori, benzer uygulamalar veya rekabet bazli keyword onerileri sunar.",
    {
      appId: z
        .string()
        .describe("App Store app ID (or: 'com.spotify.client' veya '324684580')"),
      strategy: z
        .enum(["category", "similar", "competition", "all"])
        .default("all")
        .describe("Keyword onerisi stratejisi"),
      country: z
        .string()
        .default("tr")
        .describe("Ulke kodu (tr, us, de, gb, fr...)"),
      num: z
        .number()
        .default(20)
        .describe("Her strateji icin onerilecek keyword sayisi"),
    },
    async ({ appId, strategy, country, num }) => {
      const cacheKey = `suggest:${appId}:${strategy}:${country}:${num}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const strategies =
          strategy === "all"
            ? (["category", "similar", "competition"] as const)
            : ([strategy] as const);

        const allKeywords: Record<string, string[]> = {};

        for (const s of strategies) {
          try {
            const keywords = await suggestKeywords(appId, s, country, num);
            allKeywords[s] = keywords;
          } catch {
            allKeywords[s] = [];
          }
        }

        // Benzersiz keyword'lerin skorlarini al
        const uniqueKeywords = [
          ...new Set(Object.values(allKeywords).flat()),
        ];

        const scoredKeywords = [];
        for (const kw of uniqueKeywords.slice(0, 30)) {
          try {
            const scores = await getScores(kw, country);
            scoredKeywords.push({
              keyword: kw,
              traffic: scores.traffic,
              difficulty: scores.difficulty,
            });
          } catch {
            scoredKeywords.push({
              keyword: kw,
              traffic: 0,
              difficulty: 0,
            });
          }
        }

        // Traffic'e gore sirala
        scoredKeywords.sort((a, b) => b.traffic - a.traffic);

        const result = {
          appId,
          country,
          strategies: allKeywords,
          scoredKeywords,
          totalUniqueKeywords: uniqueKeywords.length,
          topOpportunities: scoredKeywords
            .filter((k) => k.traffic > 4 && k.difficulty < 6)
            .slice(0, 10),
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.SUGGESTIONS);

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

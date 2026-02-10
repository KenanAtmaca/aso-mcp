import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getScores } from "../data-sources/aso-scoring.js";
import { searchApps } from "../data-sources/app-store.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import { getCountryName } from "../utils/localization.js";

export function registerLocalizedKeywords(server: McpServer) {
  server.tool(
    "localized_keywords",
    "Bir keyword setini farkli pazarlara adapte eder. Her ulke icin keyword skorlarini (traffic/difficulty) getirir ve o pazardaki ust siradaki uygulamalari gosterir. Coklu ulke ASO stratejisi icin kullanilir.",
    {
      keywords: z
        .array(z.string())
        .describe("Analiz edilecek keyword listesi"),
      sourceCountry: z
        .string()
        .default("tr")
        .describe("Kaynak ulke kodu"),
      targetCountries: z
        .array(z.string())
        .describe("Hedef ulke kodlari (or: ['us', 'de', 'gb', 'fr'])"),
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

        for (const country of allCountries) {
          const kwResults: {
            keyword: string;
            traffic: number;
            difficulty: number;
            topApp: string;
          }[] = [];

          for (const keyword of keywords.slice(0, 15)) {
            try {
              const scores = await getScores(keyword, country);

              // O keyword'de ilk uygulamayı al
              let topApp = "";
              try {
                const apps = await searchApps(keyword, country, 1);
                topApp = (apps[0] as any)?.title || "";
              } catch {
                // devam
              }

              kwResults.push({
                keyword,
                traffic: scores.traffic,
                difficulty: scores.difficulty,
                topApp,
              });
            } catch {
              kwResults.push({
                keyword,
                traffic: 0,
                difficulty: 0,
                topApp: "",
              });
            }
          }

          const avgTraffic =
            kwResults.length > 0
              ? kwResults.reduce((s, k) => s + k.traffic, 0) / kwResults.length
              : 0;

          const best = [...kwResults].sort(
            (a, b) =>
              b.traffic - a.traffic || a.difficulty - b.difficulty
          )[0];

          localizations.push({
            country,
            countryName: getCountryName(country),
            keywords: kwResults,
            bestKeyword: best?.keyword || null,
            avgTraffic: Math.round(avgTraffic * 10) / 10,
          });
        }

        // Ulkeleri ortalama traffic'e gore sirala
        localizations.sort((a, b) => b.avgTraffic - a.avgTraffic);

        // Keyword bazli cross-country karsilastirma
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
          content: [{ type: "text" as const, text: `Hata: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchApps, getAppDetails, getSuggestions } from "../data-sources/app-store.js";
import { getScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import {
  extractTitleKeywords,
  calculateOpportunityScore,
} from "../data-sources/custom-scoring.js";

export function registerDiscoverKeywords(server: McpServer) {
  server.tool(
    "discover_keywords",
    "Yeni bir uygulama icin sifirdan keyword kesfi yapar. Kategori, nis tanimi ve ozellik listesinden yola cikarak top uygulamalari tarar, keyword havuzu olusturur ve her keyword'u skorlar. ASO surecinin ilk adimi.",
    {
      category: z
        .string()
        .describe("App Store kategorisi (or: 'Health & Fitness', 'Productivity', 'Education')"),
      niche: z
        .string()
        .describe("Uygulamanin nis tanimi (or: 'kalori takibi ve diyet planlama', 'to-do list ve gorev yonetimi')"),
      features: z
        .array(z.string())
        .describe("Uygulamanin ana ozellikleri (or: ['kalori sayaci', 'barkod okuyucu', 'su takibi', 'diyet plani'])"),
      country: z
        .string()
        .default("tr")
        .describe("Hedef ulke kodu"),
      maxResults: z
        .number()
        .default(50)
        .describe("Maksimum keyword sayisi"),
    },
    async ({ category, niche, features, country, maxResults }) => {
      const cacheKey = `discover:${category}:${niche}:${features.join(",")}:${country}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        // ─── 1. Arama terimleri olustur ───
        const searchTerms = [
          ...niche.split(/\s+ve\s+|\s+and\s+|,\s*/).map((t) => t.trim()).filter(Boolean),
          ...features.slice(0, 8),
          category,
        ];
        const uniqueTerms = [...new Set(searchTerms)];

        // ─── 2. Her terimle App Store'da ara, top app'leri topla ───
        const allApps = new Map<string, any>();
        const termAppMap: Record<string, string[]> = {};

        for (const term of uniqueTerms.slice(0, 10)) {
          try {
            const apps = await searchApps(term, country, 10);
            termAppMap[term] = [];
            for (const app of apps) {
              const a = app as any;
              const key = a.appId || String(a.id);
              if (!allApps.has(key)) {
                allApps.set(key, a);
              }
              termAppMap[term].push(a.title);
            }
          } catch {
            // devam
          }
        }

        // ─── 3. Top app'lerin title + description'larindan keyword cikart ───
        const rawKeywords = new Map<string, { count: number; sources: string[] }>();

        for (const [key, app] of allApps) {
          const titleKws = extractTitleKeywords(app.title || "");
          const descKws = extractTitleKeywords(
            (app.description || "").slice(0, 300)
          );
          const allKws = [...new Set([...titleKws, ...descKws])];

          for (const kw of allKws) {
            if (kw.length < 2) continue;
            const existing = rawKeywords.get(kw);
            if (existing) {
              existing.count++;
              if (!existing.sources.includes(app.title)) {
                existing.sources.push(app.title);
              }
            } else {
              rawKeywords.set(kw, { count: 1, sources: [app.title] });
            }
          }
        }

        // ─── 4. App Store autocomplete onerileri ───
        for (const term of uniqueTerms.slice(0, 5)) {
          try {
            const suggestions = await getSuggestions(term);
            if (Array.isArray(suggestions)) {
              for (const s of suggestions) {
                const text = typeof s === "string" ? s : (s as any)?.term || "";
                if (text && !rawKeywords.has(text.toLowerCase())) {
                  rawKeywords.set(text.toLowerCase(), {
                    count: 1,
                    sources: ["autocomplete"],
                  });
                }
              }
            }
          } catch {
            // devam
          }
        }

        // ─── 5. Feature keyword'lerini ekle ───
        for (const feature of features) {
          const featureWords = extractTitleKeywords(feature);
          for (const fw of featureWords) {
            if (!rawKeywords.has(fw)) {
              rawKeywords.set(fw, { count: 1, sources: ["app-feature"] });
            }
          }
          // Feature'in kendisini de ekle
          const featureLower = feature.toLowerCase().trim();
          if (!rawKeywords.has(featureLower)) {
            rawKeywords.set(featureLower, { count: 1, sources: ["app-feature"] });
          }
        }

        // ─── 6. Frekanssa gore sirala, top keyword'leri skorla ───
        const sortedKeywords = [...rawKeywords.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, maxResults);

        const scoredKeywords: {
          keyword: string;
          traffic: number;
          difficulty: number;
          opportunityScore: number;
          frequency: number;
          sources: string[];
          tier: string;
        }[] = [];

        for (const [kw, data] of sortedKeywords) {
          try {
            const scores = await getScores(kw, country);
            const oppScore = calculateOpportunityScore(
              scores.traffic,
              scores.difficulty
            );

            let tier: string;
            if (oppScore >= 7) tier = "A — Yuksek firsat";
            else if (oppScore >= 5) tier = "B — Orta firsat";
            else if (oppScore >= 3) tier = "C — Dusuk firsat";
            else tier = "D — Zayif";

            scoredKeywords.push({
              keyword: kw,
              traffic: scores.traffic,
              difficulty: scores.difficulty,
              opportunityScore: Math.round(oppScore * 10) / 10,
              frequency: data.count,
              sources: data.sources.slice(0, 3),
              tier,
            });
          } catch {
            scoredKeywords.push({
              keyword: kw,
              traffic: 0,
              difficulty: 0,
              opportunityScore: 5,
              frequency: data.count,
              sources: data.sources.slice(0, 3),
              tier: "? — Skor alinamadi",
            });
          }
        }

        // Firsata gore sirala
        scoredKeywords.sort((a, b) => b.opportunityScore - a.opportunityScore);

        // ─── 7. Ozet istatistikler ───
        const tierA = scoredKeywords.filter((k) => k.tier.startsWith("A"));
        const tierB = scoredKeywords.filter((k) => k.tier.startsWith("B"));

        const result = {
          category,
          niche,
          country,
          features,
          totalAppsAnalyzed: allApps.size,
          totalKeywordsFound: scoredKeywords.length,
          summary: {
            tierA: tierA.length,
            tierB: tierB.length,
            topOpportunities: tierA.slice(0, 10).map((k) => k.keyword),
            avgTraffic:
              scoredKeywords.length > 0
                ? Math.round(
                    (scoredKeywords.reduce((s, k) => s + k.traffic, 0) /
                      scoredKeywords.length) *
                      10
                  ) / 10
                : 0,
            avgDifficulty:
              scoredKeywords.length > 0
                ? Math.round(
                    (scoredKeywords.reduce((s, k) => s + k.difficulty, 0) /
                      scoredKeywords.length) *
                      10
                  ) / 10
                : 0,
          },
          keywords: scoredKeywords,
          searchTermsUsed: uniqueTerms,
          topCompetitors: [...allApps.values()]
            .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
            .slice(0, 5)
            .map((a) => ({
              title: a.title,
              developer: a.developer,
              rating: a.score || 0,
              reviews: a.reviews || 0,
            })),
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

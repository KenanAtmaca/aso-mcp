import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchApps, getAppDetails, getSuggestions } from "../data-sources/app-store.js";
import { getScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL, CHAR_LIMITS } from "../utils/constants.js";
import { getCountryName } from "../utils/localization.js";
import {
  extractTitleKeywords,
  calculateCompetitiveScore,
  calculateOpportunityScore,
} from "../data-sources/custom-scoring.js";

export function registerGenerateAsoBrief(server: McpServer) {
  server.tool(
    "generate_aso_brief",
    "Yeni bir uygulama icin komple ASO brief olusturur. Uygulamanin adi, kategorisi, ozellikleri ve hedef kitlesinden yola cikarak: skorlanmis keyword havuzu, rakip pattern analizi, title/subtitle/keyword field icin yapilandirilmis oneriler ve karakter limitleri sunar. AI'in dogrudan ASO icerigi uretebilmesi icin hazir brief.",
    {
      appName: z
        .string()
        .describe("Uygulamanin adi"),
      category: z
        .string()
        .describe("App Store kategorisi (or: 'Health & Fitness', 'Productivity')"),
      features: z
        .array(z.string())
        .describe("Uygulamanin ana ozellikleri"),
      targetAudience: z
        .string()
        .describe("Hedef kitle tanimi (or: 'diyet yapan kadinlar 25-40 yas', 'universite ogrencileri')"),
      countries: z
        .array(z.string())
        .default(["tr"])
        .describe("Hedef ulkeler"),
      competitorAppIds: z
        .array(z.string())
        .default([])
        .describe("Bilinen rakip app ID'leri (opsiyonel)"),
    },
    async ({ appName, category, features, targetAudience, countries, competitorAppIds }) => {
      const cacheKey = `brief:${appName}:${category}:${countries.join(",")}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const primaryCountry = countries[0] || "tr";

        // ─── 1. Keyword kesfi ───
        // Arama terimleri: ozellikler + kategori + nis kombinasyonlari
        const searchTerms = [
          ...features.slice(0, 6),
          category,
          ...features.slice(0, 3).map((f) => `${f} app`),
        ];

        const keywordPool = new Map<
          string,
          { traffic: number; difficulty: number; source: string }
        >();

        // Feature ve kategori bazli arama
        for (const term of searchTerms.slice(0, 8)) {
          try {
            const apps = await searchApps(term, primaryCountry, 8);
            for (const app of apps) {
              const a = app as any;
              const kws = extractTitleKeywords(a.title || "");
              for (const kw of kws) {
                if (!keywordPool.has(kw)) {
                  keywordPool.set(kw, { traffic: 0, difficulty: 0, source: "competitor-title" });
                }
              }
            }
          } catch {
            // devam
          }
        }

        // Autocomplete onerileri
        for (const term of features.slice(0, 4)) {
          try {
            const suggestions = await getSuggestions(term);
            if (Array.isArray(suggestions)) {
              for (const s of suggestions) {
                const text = (typeof s === "string" ? s : (s as any)?.term || "").toLowerCase();
                if (text && !keywordPool.has(text)) {
                  keywordPool.set(text, { traffic: 0, difficulty: 0, source: "autocomplete" });
                }
              }
            }
          } catch {
            // devam
          }
        }

        // Feature'lerin kendilerini ekle
        for (const f of features) {
          const fl = f.toLowerCase().trim();
          if (!keywordPool.has(fl)) {
            keywordPool.set(fl, { traffic: 0, difficulty: 0, source: "app-feature" });
          }
        }

        // Keyword'leri skorla
        const scoredPool: {
          keyword: string;
          traffic: number;
          difficulty: number;
          opportunityScore: number;
          source: string;
        }[] = [];

        const poolEntries = [...keywordPool.entries()].slice(0, 40);
        for (const [kw, data] of poolEntries) {
          try {
            const scores = await getScores(kw, primaryCountry);
            const opp = calculateOpportunityScore(scores.traffic, scores.difficulty);
            scoredPool.push({
              keyword: kw,
              traffic: scores.traffic,
              difficulty: scores.difficulty,
              opportunityScore: Math.round(opp * 10) / 10,
              source: data.source,
            });
          } catch {
            scoredPool.push({
              keyword: kw,
              traffic: 0,
              difficulty: 0,
              opportunityScore: 5,
              source: data.source,
            });
          }
        }

        scoredPool.sort((a, b) => b.opportunityScore - a.opportunityScore);

        // ─── 2. Rakip analizi ───
        const competitorData: {
          title: string;
          subtitle: string;
          developer: string;
          rating: number;
          reviews: number;
          titleKeywords: string[];
          titleLength: number;
        }[] = [];

        // Bilinen rakipler
        for (const cId of competitorAppIds.slice(0, 3)) {
          try {
            const comp = await getAppDetails(cId, primaryCountry);
            competitorData.push({
              title: comp.title || "",
              subtitle: (comp as any).subtitle || "",
              developer: comp.developer || "",
              rating: comp.score || 0,
              reviews: comp.reviews || 0,
              titleKeywords: extractTitleKeywords(comp.title || ""),
              titleLength: (comp.title || "").length,
            });
          } catch {
            // devam
          }
        }

        // Top arama sonuclari da rakip olarak ekle
        if (competitorData.length < 5) {
          try {
            const topApps = await searchApps(features[0] || category, primaryCountry, 5);
            for (const app of topApps) {
              const a = app as any;
              if (competitorData.length >= 5) break;
              if (competitorData.some((c) => c.title === a.title)) continue;
              competitorData.push({
                title: a.title || "",
                subtitle: "",
                developer: a.developer || "",
                rating: a.score || 0,
                reviews: a.reviews || 0,
                titleKeywords: extractTitleKeywords(a.title || ""),
                titleLength: (a.title || "").length,
              });
            }
          } catch {
            // devam
          }
        }

        // Rakip keyword pattern'lari
        const competitorKeywordFreq: Record<string, number> = {};
        for (const comp of competitorData) {
          for (const kw of comp.titleKeywords) {
            competitorKeywordFreq[kw] = (competitorKeywordFreq[kw] || 0) + 1;
          }
        }
        const commonCompetitorKeywords = Object.entries(competitorKeywordFreq)
          .filter(([, count]) => count >= 2)
          .sort((a, b) => b[1] - a[1])
          .map(([kw]) => kw);

        const avgCompetitorTitleLength = competitorData.length > 0
          ? Math.round(
              competitorData.reduce((s, c) => s + c.titleLength, 0) /
                competitorData.length
            )
          : 0;

        // ─── 3. Rekabet durumu ───
        const competitiveScore = calculateCompetitiveScore(
          competitorData.map((c) => ({
            rating: c.rating,
            reviews: c.reviews,
            free: true,
          }))
        );

        // ─── 4. Title/Subtitle/Keyword field onerileri ───
        const topKeywords = scoredPool
          .filter((k) => k.traffic > 0)
          .slice(0, 20);

        // Title icin en yuksek traffic keyword'ler
        const titleCandidates = topKeywords
          .slice(0, 5)
          .map((k) => k.keyword);

        // Subtitle icin siradaki keyword'ler
        const subtitleCandidates = topKeywords
          .slice(3, 10)
          .map((k) => k.keyword);

        // Keyword field icin kalanlar
        const usedInTitleSubtitle = new Set([
          ...titleCandidates,
          ...subtitleCandidates,
        ]);
        const keywordFieldCandidates = topKeywords
          .filter((k) => !usedInTitleSubtitle.has(k.keyword))
          .map((k) => k.keyword);

        // ─── 5. Coklu pazar analizi ───
        const marketAnalysis: {
          country: string;
          countryName: string;
          topKeywords: { keyword: string; traffic: number; difficulty: number }[];
        }[] = [];

        for (const c of countries) {
          if (c === primaryCountry) {
            marketAnalysis.push({
              country: c,
              countryName: getCountryName(c),
              topKeywords: topKeywords.slice(0, 10).map((k) => ({
                keyword: k.keyword,
                traffic: k.traffic,
                difficulty: k.difficulty,
              })),
            });
            continue;
          }

          const marketKws: { keyword: string; traffic: number; difficulty: number }[] = [];
          for (const kw of topKeywords.slice(0, 8)) {
            try {
              const scores = await getScores(kw.keyword, c);
              marketKws.push({
                keyword: kw.keyword,
                traffic: scores.traffic,
                difficulty: scores.difficulty,
              });
            } catch {
              marketKws.push({ keyword: kw.keyword, traffic: 0, difficulty: 0 });
            }
          }
          marketAnalysis.push({
            country: c,
            countryName: getCountryName(c),
            topKeywords: marketKws,
          });
        }

        // ─── 6. Brief olustur ───
        const result = {
          appName,
          category,
          targetAudience,
          features,
          countries: countries.map((c) => ({ code: c, name: getCountryName(c) })),
          primaryCountry,

          competitiveAnalysis: {
            competitiveScore: Math.round(competitiveScore * 10) / 10,
            level:
              competitiveScore > 7
                ? "Yuksek rekabet"
                : competitiveScore > 4
                ? "Orta rekabet"
                : "Dusuk rekabet",
            competitors: competitorData,
            commonCompetitorKeywords,
            avgCompetitorTitleLength,
          },

          keywordPool: {
            total: scoredPool.length,
            topOpportunities: scoredPool.filter((k) => k.opportunityScore >= 6).slice(0, 15),
            allKeywords: scoredPool,
          },

          metadataGuidelines: {
            title: {
              maxLength: CHAR_LIMITS.TITLE,
              recommendation: `"${appName}" + en yuksek traffic keyword. Rakipler ortalama ${avgCompetitorTitleLength} karakter kullanıyor.`,
              candidateKeywords: titleCandidates,
              pattern: `${appName} - [keyword1] [keyword2]`,
              examples: competitorData.slice(0, 3).map((c) => c.title),
            },
            subtitle: {
              maxLength: CHAR_LIMITS.SUBTITLE,
              recommendation: "Title'da olmayan yuksek traffic keyword'leri kullan.",
              candidateKeywords: subtitleCandidates,
            },
            keywordField: {
              maxLength: CHAR_LIMITS.KEYWORD_FIELD,
              recommendation: "Title ve subtitle'da olmayan keyword'leri virgul ile ayir. Bosluk kullanma.",
              candidateKeywords: keywordFieldCandidates,
            },
            description: {
              recommendation: "Ilk 3 cumle kritik — en onemli keyword'leri buraya yerlestir. Apple artik description'i da keyword analizi icin kullaniyor.",
              mustIncludeKeywords: topKeywords.slice(0, 8).map((k) => k.keyword),
            },
          },

          marketAnalysis,

          actionPlan: [
            `1. Title olustur: "${appName}" + [${titleCandidates.slice(0, 2).join(", ")}] (max ${CHAR_LIMITS.TITLE} karakter)`,
            `2. Subtitle olustur: [${subtitleCandidates.slice(0, 3).join(", ")}] (max ${CHAR_LIMITS.SUBTITLE} karakter)`,
            `3. Keyword field doldur: ${keywordFieldCandidates.slice(0, 5).join(",")} (max ${CHAR_LIMITS.KEYWORD_FIELD} karakter, virgul ayracli)`,
            `4. Aciklama yaz: Ilk 3 cumlede [${topKeywords.slice(0, 3).map((k) => k.keyword).join(", ")}] keyword'lerini kullan`,
            `5. ${countries.length > 1 ? `${countries.length} pazar icin lokalize et` : "Tek pazar odakli optimize et"}`,
            `6. Rakiplerin pattern'ini takip et: ${commonCompetitorKeywords.slice(0, 5).join(", ") || "benzersiz alan"}`,
          ],
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

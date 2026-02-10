import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAppDetails, searchApps } from "../data-sources/app-store.js";
import { getScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL, CHAR_LIMITS } from "../utils/constants.js";
import { extractTitleKeywords } from "../data-sources/custom-scoring.js";

export function registerOptimizeMetadata(server: McpServer) {
  server.tool(
    "optimize_metadata",
    "Bir uygulamanin title, subtitle ve keyword field icin optimizasyon onerisi sunar. Karakter limiti kontrolu dahil. Hedef keyword'lere gore metadata iyilestirmesi yapar.",
    {
      appId: z
        .string()
        .describe("App Store app ID veya bundle ID"),
      targetKeywords: z
        .array(z.string())
        .describe("Hedeflenen keyword'ler listesi"),
      country: z
        .string()
        .default("tr")
        .describe("Ulke kodu (tr, us, de, gb, fr...)"),
    },
    async ({ appId, targetKeywords, country }) => {
      const cacheKey = `metadata:${appId}:${targetKeywords.join(",")}:${country}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const app = await getAppDetails(appId, country);

        // Keyword skorlarını al
        const keywordScores: Record<
          string,
          { traffic: number; difficulty: number }
        > = {};
        for (const kw of targetKeywords.slice(0, 15)) {
          try {
            keywordScores[kw] = await getScores(kw, country);
          } catch {
            keywordScores[kw] = { traffic: 0, difficulty: 0 };
          }
        }

        // Keyword'leri traffic'e göre sırala
        const sortedKeywords = [...targetKeywords].sort((a, b) => {
          const aScore = keywordScores[a]?.traffic ?? 0;
          const bScore = keywordScores[b]?.traffic ?? 0;
          return bScore - aScore;
        });

        // Mevcut title keyword'leri
        const currentTitleKeywords = extractTitleKeywords(app.title || "");

        // Title önerisi: en yüksek traffic keyword'leri dahil et
        const titleKeywordsToInclude = sortedKeywords.slice(0, 3);
        const appName = (app.title || "").split(/[-:|]/)[0].trim();
        const suggestedTitleParts = [appName];
        const remainingChars = CHAR_LIMITS.TITLE - appName.length - 3;
        if (remainingChars > 3) {
          const suffix = titleKeywordsToInclude
            .filter((kw) => !appName.toLowerCase().includes(kw.toLowerCase()))
            .join(" ");
          if (suffix.length <= remainingChars) {
            suggestedTitleParts.push(suffix);
          }
        }
        const suggestedTitle = suggestedTitleParts.join(" - ").slice(0, CHAR_LIMITS.TITLE);

        // Subtitle önerisi
        const subtitleKeywords = sortedKeywords
          .filter(
            (kw) =>
              !suggestedTitle.toLowerCase().includes(kw.toLowerCase())
          )
          .slice(0, 4);
        const suggestedSubtitle = subtitleKeywords
          .join(", ")
          .slice(0, CHAR_LIMITS.SUBTITLE);

        // Keyword field önerisi (title ve subtitle'da olmayanlar)
        const usedKeywords = new Set(
          [
            ...extractTitleKeywords(suggestedTitle),
            ...extractTitleKeywords(suggestedSubtitle),
          ].map((k) => k.toLowerCase())
        );
        const keywordFieldWords = sortedKeywords
          .filter((kw) => !usedKeywords.has(kw.toLowerCase()))
          .concat(
            sortedKeywords.flatMap((kw) =>
              kw
                .split(/\s+/)
                .filter((w) => w.length > 1 && !usedKeywords.has(w.toLowerCase()))
            )
          );
        const uniqueFieldWords = [...new Set(keywordFieldWords)];
        let keywordField = "";
        for (const word of uniqueFieldWords) {
          const next = keywordField
            ? keywordField + "," + word
            : word;
          if (next.length <= CHAR_LIMITS.KEYWORD_FIELD) {
            keywordField = next;
          }
        }

        // Rakip analizi: aynı keyword'de top app'ler ne kullanıyor
        let competitorKeywords: string[] = [];
        try {
          const topApps = await searchApps(
            sortedKeywords[0] || app.title,
            country,
            5
          );
          competitorKeywords = [
            ...new Set(
              topApps.flatMap((a: any) => extractTitleKeywords(a.title || ""))
            ),
          ].filter((kw) => !usedKeywords.has(kw));
        } catch {
          // devam
        }

        // Uyarılar
        const warnings: string[] = [];
        if (suggestedTitle.length > CHAR_LIMITS.TITLE) {
          warnings.push(
            `Title ${suggestedTitle.length} karakter — limit ${CHAR_LIMITS.TITLE}`
          );
        }
        if (suggestedSubtitle.length > CHAR_LIMITS.SUBTITLE) {
          warnings.push(
            `Subtitle ${suggestedSubtitle.length} karakter — limit ${CHAR_LIMITS.SUBTITLE}`
          );
        }
        if (keywordField.length > CHAR_LIMITS.KEYWORD_FIELD) {
          warnings.push(
            `Keyword field ${keywordField.length} karakter — limit ${CHAR_LIMITS.KEYWORD_FIELD}`
          );
        }
        if (keywordField.includes(" ")) {
          warnings.push(
            "Keyword field'da bosluk kullanma — virgul ile ayir"
          );
        }

        const result = {
          appId,
          country,
          current: {
            title: app.title || "",
            titleLength: (app.title || "").length,
            titleKeywords: currentTitleKeywords,
          },
          suggested: {
            title: suggestedTitle,
            titleLength: suggestedTitle.length,
            subtitle: suggestedSubtitle,
            subtitleLength: suggestedSubtitle.length,
            keywordField,
            keywordFieldLength: keywordField.length,
          },
          characterLimits: {
            title: {
              used: suggestedTitle.length,
              max: CHAR_LIMITS.TITLE,
              remaining: CHAR_LIMITS.TITLE - suggestedTitle.length,
            },
            subtitle: {
              used: suggestedSubtitle.length,
              max: CHAR_LIMITS.SUBTITLE,
              remaining: CHAR_LIMITS.SUBTITLE - suggestedSubtitle.length,
            },
            keywords: {
              used: keywordField.length,
              max: CHAR_LIMITS.KEYWORD_FIELD,
              remaining: CHAR_LIMITS.KEYWORD_FIELD - keywordField.length,
            },
          },
          keywordScores,
          competitorKeywords: competitorKeywords.slice(0, 15),
          warnings,
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

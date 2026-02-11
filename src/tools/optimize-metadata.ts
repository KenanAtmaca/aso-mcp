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
    "Provides optimization suggestions for an app's title, subtitle, and keyword field. Includes character limit checks. Improves metadata based on target keywords.",
    {
      appId: z
        .string()
        .describe("App Store app ID or bundle ID"),
      targetKeywords: z
        .array(z.string())
        .describe("List of target keywords"),
      country: z
        .string()
        .default("tr")
        .describe("Country code (tr, us, de, gb, fr...)"),
    },
    async ({ appId, targetKeywords, country }) => {
      const cacheKey = `metadata:${appId}:${targetKeywords.join(",")}:${country}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const app = await getAppDetails(appId, country);

        // Get keyword scores
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

        // Sort keywords by traffic
        const sortedKeywords = [...targetKeywords].sort((a, b) => {
          const aScore = keywordScores[a]?.traffic ?? 0;
          const bScore = keywordScores[b]?.traffic ?? 0;
          return bScore - aScore;
        });

        // Current title keywords
        const currentTitleKeywords = extractTitleKeywords(app.title || "");

        // Title suggestion: include highest traffic keywords
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

        // Subtitle suggestion
        const subtitleKeywords = sortedKeywords
          .filter(
            (kw) =>
              !suggestedTitle.toLowerCase().includes(kw.toLowerCase())
          )
          .slice(0, 4);
        const suggestedSubtitle = subtitleKeywords
          .join(", ")
          .slice(0, CHAR_LIMITS.SUBTITLE);

        // Keyword field suggestion (keywords not in title and subtitle)
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

        // Competitor analysis: what top apps use for the same keyword
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
          // continue
        }

        // Warnings
        const warnings: string[] = [];
        if (suggestedTitle.length > CHAR_LIMITS.TITLE) {
          warnings.push(
            `Title is ${suggestedTitle.length} chars — limit is ${CHAR_LIMITS.TITLE}`
          );
        }
        if (suggestedSubtitle.length > CHAR_LIMITS.SUBTITLE) {
          warnings.push(
            `Subtitle is ${suggestedSubtitle.length} chars — limit is ${CHAR_LIMITS.SUBTITLE}`
          );
        }
        if (keywordField.length > CHAR_LIMITS.KEYWORD_FIELD) {
          warnings.push(
            `Keyword field is ${keywordField.length} chars — limit is ${CHAR_LIMITS.KEYWORD_FIELD}`
          );
        }
        if (keywordField.includes(" ")) {
          warnings.push(
            "Do not use spaces in the keyword field — separate with commas"
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
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}

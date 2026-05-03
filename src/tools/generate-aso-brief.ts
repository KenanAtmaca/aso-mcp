import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchApps, getAppDetails, getSuggestions } from "../data-sources/app-store.js";
import { batchGetScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL, CHAR_LIMITS } from "../utils/constants.js";
import { getCountryName } from "../utils/localization.js";
import {
  extractTitleKeywords,
  calculateCompetitiveScore,
  calculateOpportunityScore,
} from "../data-sources/custom-scoring.js";
import { OPPORTUNITY_TIERS } from "../utils/formatters.js";

/**
 * Greedy-pack keyword candidates into App Store's 100-char comma-separated
 * keyword field. Splits multi-word candidates into individual tokens (each
 * is indexed separately by Apple), excludes anything already used in
 * title/subtitle (those slots are wasted), dedupes, and strips spaces.
 * Returns the actual ready-to-paste string plus what was used vs left over.
 */
function packKeywordField(
  candidates: string[],
  maxLength: number,
  excludedTokens: Set<string>
): { packed: string; used: string[]; unused: string[]; excluded: string[] } {
  const seen = new Set<string>();
  const tokens: string[] = [];
  const excluded: string[] = [];

  for (const cand of candidates) {
    const parts = cand
      .toLowerCase()
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    for (const part of parts) {
      if (seen.has(part)) continue;
      seen.add(part);
      if (excludedTokens.has(part)) {
        excluded.push(part);
        continue;
      }
      tokens.push(part);
    }
  }

  let packed = "";
  const used: string[] = [];
  const unused: string[] = [];
  for (const tok of tokens) {
    const next = packed ? `${packed},${tok}` : tok;
    if (next.length <= maxLength) {
      packed = next;
      used.push(tok);
    } else {
      unused.push(tok);
    }
  }
  return { packed, used, unused, excluded };
}

export function registerGenerateAsoBrief(server: McpServer) {
  server.tool(
    "generate_aso_brief",
    "Generates a complete ASO brief for a new app. Based on the app's name, category, features, and target audience, it provides: a scored keyword pool, competitor pattern analysis, structured suggestions for title/subtitle/keyword field, and character limits. A ready-made brief for AI to directly produce ASO content.",
    {
      appName: z
        .string()
        .min(1)
        .max(50)
        .describe("App name"),
      category: z
        .string()
        .min(1)
        .describe("App Store category (e.g. 'Health & Fitness', 'Productivity')"),
      features: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe("App's main features"),
      targetAudience: z
        .string()
        .min(1)
        .describe("Target audience description (e.g. 'women on a diet aged 25-40', 'college students')"),
      countries: z
        .array(z.string().min(2).max(5))
        .default(["tr"])
        .describe("Target countries"),
      competitorAppIds: z
        .array(z.string())
        .default([])
        .describe("Known competitor app IDs (optional)"),
    },
    async ({ appName, category, features, targetAudience, countries, competitorAppIds }) => {
      const featuresHash = [...features].sort().join(",");
      const competitorsHash = [...competitorAppIds].sort().join(",");
      const countriesHash = [...countries].sort().join(",");
      const cacheKey = `brief:${appName}:${category}:${featuresHash}:${targetAudience}:${countriesHash}:${competitorsHash}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const primaryCountry = countries[0] || "tr";

        // ─── 1. Keyword discovery ───
        // Search terms: features + category + niche combinations
        const searchTerms = [
          ...features.slice(0, 6),
          category,
          ...features.slice(0, 3).map((f) => `${f} app`),
        ];

        const keywordPool = new Map<
          string,
          { traffic: number; difficulty: number; source: string }
        >();

        // Feature and category based search
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
            // continue
          }
        }

        // Autocomplete suggestions
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
            // continue
          }
        }

        // Add features themselves
        for (const f of features) {
          const fl = f.toLowerCase().trim();
          if (!keywordPool.has(fl)) {
            keywordPool.set(fl, { traffic: 0, difficulty: 0, source: "app-feature" });
          }
        }

        // Score keywords (in parallel)
        const poolEntries = [...keywordPool.entries()].slice(0, 40);
        const batchScores = await batchGetScores(
          poolEntries.map(([kw]) => kw),
          primaryCountry
        );
        const scoreMap = new Map(batchScores.map((s) => [s.keyword, s]));

        const scoredPool: {
          keyword: string;
          traffic: number;
          difficulty: number;
          opportunityScore: number;
          source: string;
        }[] = [];

        for (const [kw, data] of poolEntries) {
          const scores = scoreMap.get(kw) || { traffic: 0, difficulty: 0 };
          const opp = calculateOpportunityScore(scores.traffic, scores.difficulty);
          scoredPool.push({
            keyword: kw,
            traffic: scores.traffic,
            difficulty: scores.difficulty,
            opportunityScore: Math.round(opp * 10) / 10,
            source: data.source,
          });
        }

        scoredPool.sort((a, b) => b.opportunityScore - a.opportunityScore);

        // ─── 2. Competitor analysis ───
        const competitorData: {
          title: string;
          subtitle: string;
          developer: string;
          rating: number;
          reviews: number;
          titleKeywords: string[];
          titleLength: number;
        }[] = [];

        // Known competitors
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
            // continue
          }
        }

        // Also add top search results as competitors
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
            // continue
          }
        }

        // Competitor keyword patterns
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

        // ─── 3. Competition level ───
        const competitiveScore = calculateCompetitiveScore(
          competitorData.map((c) => ({
            rating: c.rating,
            reviews: c.reviews,
            free: true,
          }))
        );

        // ─── 4. Title/Subtitle/Keyword field suggestions ───
        const topKeywords = scoredPool
          .filter((k) => k.traffic > 0)
          .slice(0, 20);

        // Highest traffic keywords for title
        const titleCandidates = topKeywords
          .slice(0, 5)
          .map((k) => k.keyword);

        // Next keywords for subtitle
        const subtitleCandidates = topKeywords
          .slice(3, 10)
          .map((k) => k.keyword);

        // Remaining for keyword field
        const usedInTitleSubtitle = new Set([
          ...titleCandidates,
          ...subtitleCandidates,
        ]);
        const keywordFieldCandidates = topKeywords
          .filter((k) => !usedInTitleSubtitle.has(k.keyword))
          .map((k) => k.keyword);

        // Tokens already covered by appName + title + subtitle (appearing in
        // those metadata fields makes including them in the keyword field
        // wasteful since Apple already indexes them).
        const reservedTokens = new Set<string>(
          [appName, ...titleCandidates, ...subtitleCandidates]
            .flatMap((s) => s.toLowerCase().split(/\s+/))
            .filter((t) => t.length >= 2)
        );

        const keywordFieldPack = packKeywordField(
          keywordFieldCandidates,
          CHAR_LIMITS.KEYWORD_FIELD,
          reservedTokens
        );

        // Build a concrete, ready-to-use suggested title that actually fits
        // 30 chars. Greedy-pack the highest-traffic keywords after the app name.
        const titleSeparator = " - ";
        const titleWarnings: string[] = [];
        let suggestedTitle = appName.trim();
        if (suggestedTitle.length > CHAR_LIMITS.TITLE) {
          titleWarnings.push(
            `App name '${appName}' is ${suggestedTitle.length} chars and exceeds the ${CHAR_LIMITS.TITLE}-char title limit. Consider a shorter brand.`
          );
          suggestedTitle = suggestedTitle.slice(0, CHAR_LIMITS.TITLE);
        } else {
          const room = CHAR_LIMITS.TITLE - suggestedTitle.length - titleSeparator.length;
          if (room > 3) {
            let suffix = "";
            for (const kw of titleCandidates) {
              const lowerKw = kw.toLowerCase();
              if (suggestedTitle.toLowerCase().includes(lowerKw)) continue;
              if (suffix.toLowerCase().includes(lowerKw)) continue;
              const next = suffix ? `${suffix} ${kw}` : kw;
              if (next.length <= room) suffix = next;
            }
            if (suffix) suggestedTitle = `${suggestedTitle}${titleSeparator}${suffix}`;
          }
        }

        // Same packing for subtitle, comma-separated
        let suggestedSubtitle = "";
        for (const kw of subtitleCandidates) {
          const lowerKw = kw.toLowerCase();
          if (suggestedTitle.toLowerCase().includes(lowerKw)) continue;
          if (suggestedSubtitle.toLowerCase().includes(lowerKw)) continue;
          const next = suggestedSubtitle ? `${suggestedSubtitle}, ${kw}` : kw;
          if (next.length <= CHAR_LIMITS.SUBTITLE) suggestedSubtitle = next;
        }

        // ─── 5. Multi-market analysis (countries scored in parallel) ───
        const marketAnalysis = await Promise.all(
          countries.map(async (c) => {
            if (c === primaryCountry) {
              return {
                country: c,
                countryName: getCountryName(c),
                topKeywords: topKeywords.slice(0, 10).map((k) => ({
                  keyword: k.keyword,
                  traffic: k.traffic,
                  difficulty: k.difficulty,
                })),
              };
            }

            const marketTopKws = topKeywords.slice(0, 8);
            const marketScores = await batchGetScores(
              marketTopKws.map((k) => k.keyword),
              c
            );
            const marketScoreMap = new Map(
              marketScores.map((s) => [s.keyword, s])
            );

            return {
              country: c,
              countryName: getCountryName(c),
              topKeywords: marketTopKws.map((k) => {
                const s = marketScoreMap.get(k.keyword) ?? {
                  traffic: 0,
                  difficulty: 0,
                };
                return {
                  keyword: k.keyword,
                  traffic: s.traffic,
                  difficulty: s.difficulty,
                };
              }),
            };
          })
        );

        // ─── 6. Build brief ───
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
                ? "High competition"
                : competitiveScore > 4
                ? "Medium competition"
                : "Low competition",
            competitors: competitorData,
            commonCompetitorKeywords,
            avgCompetitorTitleLength,
          },

          keywordPool: {
            total: scoredPool.length,
            topOpportunities: scoredPool
              .filter((k) => k.opportunityScore >= OPPORTUNITY_TIERS.MEDIUM)
              .slice(0, 15),
            allKeywords: scoredPool,
          },

          metadataGuidelines: {
            title: {
              maxLength: CHAR_LIMITS.TITLE,
              recommendation: `App name + highest traffic keywords, separated by " - ". Competitors use ${avgCompetitorTitleLength} chars on average.`,
              suggested: suggestedTitle,
              suggestedLength: suggestedTitle.length,
              suggestedRemaining: CHAR_LIMITS.TITLE - suggestedTitle.length,
              candidateKeywords: titleCandidates,
              pattern: `${appName} - [keyword1] [keyword2]`,
              examples: competitorData.slice(0, 3).map((c) => c.title),
              warnings: titleWarnings.length > 0 ? titleWarnings : undefined,
            },
            subtitle: {
              maxLength: CHAR_LIMITS.SUBTITLE,
              recommendation: "Comma-separated high-traffic keywords that are not in the title.",
              suggested: suggestedSubtitle,
              suggestedLength: suggestedSubtitle.length,
              suggestedRemaining: CHAR_LIMITS.SUBTITLE - suggestedSubtitle.length,
              candidateKeywords: subtitleCandidates,
            },
            keywordField: {
              maxLength: CHAR_LIMITS.KEYWORD_FIELD,
              recommendation:
                "Separate keywords with commas, no spaces. Tokens already in title/subtitle are excluded automatically (Apple indexes them once).",
              packed: keywordFieldPack.packed,
              packedLength: keywordFieldPack.packed.length,
              packedKeywords: keywordFieldPack.used,
              droppedDueToLimit: keywordFieldPack.unused,
              excludedDueToTitleSubtitle: keywordFieldPack.excluded,
              candidateKeywords: keywordFieldCandidates,
            },
            description: {
              recommendation: "First 3 sentences are critical. Place the most important keywords here. Apple now also uses the description for keyword analysis.",
              mustIncludeKeywords: topKeywords.slice(0, 8).map((k) => k.keyword),
            },
          },

          marketAnalysis,

          actionPlan: [
            `1. Title (${suggestedTitle.length}/${CHAR_LIMITS.TITLE} chars): "${suggestedTitle}"`,
            `2. Subtitle (${suggestedSubtitle.length}/${CHAR_LIMITS.SUBTITLE} chars): "${suggestedSubtitle}"`,
            `3. Keyword field (${keywordFieldPack.packed.length}/${CHAR_LIMITS.KEYWORD_FIELD} chars): ${keywordFieldPack.packed}`,
            `4. Description: Place [${topKeywords.slice(0, 3).map((k) => k.keyword).join(", ")}] in the first 3 sentences`,
            `5. ${countries.length > 1 ? `Localize for ${countries.length} markets` : "Optimize for single market"}`,
            `6. Common competitor patterns to consider: ${commonCompetitorKeywords.slice(0, 5).join(", ") || "no shared patterns (unique space)"}`,
          ],
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.KEYWORD_SCORES);

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

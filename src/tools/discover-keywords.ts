import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchApps, getSuggestions } from "../data-sources/app-store.js";
import { batchGetScores } from "../data-sources/aso-scoring.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";
import {
  extractTitleKeywords,
  calculateOpportunityScore,
} from "../data-sources/custom-scoring.js";
import {
  classifyOpportunity,
  scoresCacheTtl,
  scoresSourceNote,
  summarizeScoresSource,
} from "../utils/formatters.js";

export function registerDiscoverKeywords(server: McpServer) {
  server.tool(
    "discover_keywords",
    "Performs keyword discovery from scratch for a new app. Scans top apps based on category, niche definition, and feature list, builds a keyword pool, and scores each keyword. The first step of the ASO process.",
    {
      category: z
        .string()
        .min(1)
        .describe("App Store category (e.g. 'Health & Fitness', 'Productivity', 'Education')"),
      niche: z
        .string()
        .min(1)
        .describe("App's niche definition (e.g. 'calorie tracking and diet planning', 'to-do list and task management')"),
      features: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe("App's main features (e.g. ['calorie counter', 'barcode scanner', 'water tracking', 'diet plan'])"),
      country: z
        .string()
        .min(2)
        .max(5)
        .default("tr")
        .describe("Target country code"),
      maxResults: z
        .number()
        .min(10)
        .max(100)
        .default(50)
        .describe("Maximum number of keywords"),
    },
    async ({ category, niche, features, country, maxResults }) => {
      const featuresHash = [...features].sort().join(",");
      const cacheKey = `discover:${category}:${niche}:${featuresHash}:${country}:${maxResults}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        // ─── 1. Build search terms ───
        const searchTerms = [
          ...niche.split(/\s+ve\s+|\s+and\s+|,\s*/).map((t) => t.trim()).filter(Boolean),
          ...features.slice(0, 8),
          category,
        ];
        const uniqueTerms = [...new Set(searchTerms)];

        // ─── 2. Search App Store for each term, collect top apps ───
        // Terms run in parallel; the rate limiter queues the actual requests.
        const allApps = new Map<string, any>();
        const termAppMap: Record<string, string[]> = {};

        const termResults = await Promise.all(
          uniqueTerms.slice(0, 10).map(async (term) => {
            try {
              return { term, apps: await searchApps(term, country, 10) };
            } catch {
              return { term, apps: [] as any[] };
            }
          })
        );
        for (const { term, apps } of termResults) {
          if (apps.length === 0) continue;
          termAppMap[term] = [];
          for (const app of apps) {
            const a = app as any;
            const key = a.appId || String(a.id);
            if (!allApps.has(key)) {
              allApps.set(key, a);
            }
            termAppMap[term].push(a.title);
          }
        }

        // ─── 3. Build brand stop list from top apps ───
        // Competitor brand names (Spotify, Instagram, Adobe, etc.) leak into the
        // keyword pool through title-prefix extraction. Including them in our
        // suggestions for a NEW app is a trademark risk and irrelevant to the
        // user's actual ASO. Build a per-search brand list and filter it out.
        const COMPANY_SUFFIXES = new Set([
          "inc", "inc.", "llc", "ltd", "ltd.", "corp", "corp.",
          "co", "co.", "gmbh", "group", "studio", "studios", "labs",
        ]);
        const brandStopList = new Set<string>();
        for (const [, app] of allApps) {
          const a = app as any;
          // Title prefix before the first separator is usually the brand
          const titlePrefix = (a.title || "")
            .split(/[-:|·\u2014\u2013]/)[0]
            .trim()
            .toLowerCase();
          if (
            titlePrefix &&
            !titlePrefix.includes(" ") &&
            titlePrefix.length > 2
          ) {
            brandStopList.add(titlePrefix);
          }
          // Single-word developer names (likely brand)
          const devTokens = (a.developer || "")
            .toLowerCase()
            .split(/\s+/)
            .filter(
              (t: string) => t.length > 2 && !COMPANY_SUFFIXES.has(t)
            );
          if (devTokens.length === 1) {
            brandStopList.add(devTokens[0]);
          }
        }

        // ─── 4. Extract keywords from top apps' title + description ───
        const rawKeywords = new Map<string, { count: number; sources: string[] }>();

        for (const [, app] of allApps) {
          const titleKws = extractTitleKeywords(app.title || "");
          const descKws = extractTitleKeywords(
            (app.description || "").slice(0, 300)
          );
          const allKws = [...new Set([...titleKws, ...descKws])];

          for (const kw of allKws) {
            if (kw.length < 2) continue;
            if (brandStopList.has(kw)) continue;
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

        // ─── 5. App Store autocomplete suggestions (parallel, market-specific) ───
        const suggestionResults = await Promise.all(
          uniqueTerms
            .slice(0, 5)
            .map((term) => getSuggestions(term, country).catch(() => [] as string[]))
        );
        for (const text of suggestionResults.flat()) {
          if (text && !rawKeywords.has(text.toLowerCase())) {
            rawKeywords.set(text.toLowerCase(), {
              count: 1,
              sources: ["autocomplete"],
            });
          }
        }

        // ─── 6. Add feature keywords ───
        for (const feature of features) {
          const featureWords = extractTitleKeywords(feature);
          for (const fw of featureWords) {
            if (!rawKeywords.has(fw)) {
              rawKeywords.set(fw, { count: 1, sources: ["app-feature"] });
            }
          }
          // Also add the feature itself
          const featureLower = feature.toLowerCase().trim();
          if (!rawKeywords.has(featureLower)) {
            rawKeywords.set(featureLower, { count: 1, sources: ["app-feature"] });
          }
        }

        // ─── 7. Sort by frequency, score top keywords (in parallel) ───
        const sortedKeywords = [...rawKeywords.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, maxResults);

        const batchScores = await batchGetScores(
          sortedKeywords.map(([kw]) => kw),
          country
        );

        const scoreMap = new Map(batchScores.map((s) => [s.keyword, s]));

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
          const scores = scoreMap.get(kw) || { traffic: 0, difficulty: 0 };
          const oppScore = calculateOpportunityScore(
            scores.traffic,
            scores.difficulty
          );

          const { label: tier } = classifyOpportunity(oppScore);

          scoredKeywords.push({
            keyword: kw,
            traffic: scores.traffic,
            difficulty: scores.difficulty,
            opportunityScore: Math.round(oppScore * 10) / 10,
            frequency: data.count,
            sources: data.sources.slice(0, 3),
            tier,
          });
        }

        // Sort by opportunity
        scoredKeywords.sort((a, b) => b.opportunityScore - a.opportunityScore);

        // ─── 8. Summary statistics ───
        const tierA = scoredKeywords.filter((k) => k.tier.startsWith("A"));
        const tierB = scoredKeywords.filter((k) => k.tier.startsWith("B"));

        const scoresSource = summarizeScoresSource(batchScores);

        const result = {
          category,
          niche,
          country,
          features,
          scoresSource,
          scoresNote: scoresSourceNote(scoresSource),
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
        setCache(
          cacheKey,
          resultText,
          scoresCacheTtl(CACHE_TTL.KEYWORD_SCORES, scoresSource)
        );

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

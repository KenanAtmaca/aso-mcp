import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAppDetails, getReviews } from "../data-sources/app-store.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";

// Simple sentiment keywords
const POSITIVE_WORDS = new Set([
  // Turkish
  "harika", "mukemmel", "super", "guzel", "kolay", "hizli", "sevdim",
  "basarili", "kaliteli", "tavsiye", "ederim", "ideal", "faydali",
  "kullanisli", "pratik", "efektif", "begendim",
  // English
  "great", "amazing", "awesome", "love", "excellent", "perfect",
  "good", "best", "fantastic", "wonderful", "helpful", "easy",
  "fast", "recommend", "nice", "useful",
]);

const NEGATIVE_WORDS = new Set([
  // Turkish
  "kotu", "berbat", "yavaş", "hata", "bug", "cokma", "calısmiyor",
  "bozuk", "sikiyor", "reklam", "pahali", "gereksiz", "zor",
  "karmasik", "siliyorum", "cöp", "rezalet", "felaket", "saçma",
  // English
  "bad", "terrible", "awful", "hate", "worst", "horrible", "slow",
  "crash", "bug", "broken", "ads", "expensive", "useless",
  "annoying", "frustrating", "delete", "uninstall",
]);

const FEATURE_INDICATORS = [
  // Turkish
  "eklensin", "eklenmeli", "olsa", "istiyorum", "lazim", "gerek",
  "olmali", "bekliyorum", "güncelleme", "özellik",
  // English
  "should", "please add", "would be nice", "wish", "need", "want",
  "feature request", "missing",
];

function analyzeSentiment(text: string): "positive" | "negative" | "neutral" {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) positiveCount++;
    if (NEGATIVE_WORDS.has(word)) negativeCount++;
  }

  if (positiveCount > negativeCount) return "positive";
  if (negativeCount > positiveCount) return "negative";
  return "neutral";
}

function isFeatureRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return FEATURE_INDICATORS.some((indicator) => lower.includes(indicator));
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "is", "it", "this", "that", "ve", "ile", "bir", "bu", "da",
    "de", "mi", "mu", "icin", "çok", "var", "ben", "app", "uygulama",
  ]);
  return text
    .toLowerCase()
    .split(/[\s,.!?;:]+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

export function registerAnalyzeReviews(server: McpServer) {
  server.tool(
    "analyze_reviews",
    "Performs sentiment analysis on an app's user reviews, extracts complaints and feature requests. Provides keyword insights for ASO.",
    {
      appId: z
        .string()
        .describe("App Store app ID or bundle ID"),
      country: z
        .string()
        .default("tr")
        .describe("Country code"),
      pages: z
        .number()
        .default(3)
        .describe("Number of review pages to fetch (each page ~50 reviews)"),
    },
    async ({ appId, country, pages }) => {
      const cacheKey = `reviews:${appId}:${country}:${pages}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        // Get app info (numeric ID required)
        const app = await getAppDetails(appId, country);
        const numericId = app.id;

        // Fetch reviews
        const allReviews: any[] = [];
        for (let page = 1; page <= pages; page++) {
          try {
            const pageReviews = await getReviews(numericId, country, page);
            allReviews.push(...pageReviews);
          } catch {
            break; // no more pages
          }
        }

        if (allReviews.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  appId,
                  message: "No reviews found for this app.",
                }),
              },
            ],
          };
        }

        // Sentiment analysis
        let positive = 0;
        let negative = 0;
        let neutral = 0;

        const complaints: string[] = [];
        const featureRequests: string[] = [];
        const keywordMap: Record<string, number> = {};

        for (const review of allReviews) {
          const text = review.text || review.body || "";
          const title = review.title || "";
          const fullText = `${title} ${text}`;
          const sentiment = analyzeSentiment(fullText);

          if (sentiment === "positive") positive++;
          else if (sentiment === "negative") negative++;
          else neutral++;

          // Complaints (negative reviews)
          if (sentiment === "negative" && text.length > 10) {
            complaints.push(
              text.length > 150 ? text.slice(0, 150) + "..." : text
            );
          }

          // Feature requests
          if (isFeatureRequest(fullText)) {
            featureRequests.push(
              fullText.length > 150 ? fullText.slice(0, 150) + "..." : fullText
            );
          }

          // Keyword extraction
          for (const kw of extractKeywords(fullText)) {
            keywordMap[kw] = (keywordMap[kw] || 0) + 1;
          }
        }

        // Most frequent keywords (ASO insight)
        const keywordInsights = Object.entries(keywordMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([keyword, count]) => ({ keyword, count }));

        // Rating distribution
        const ratingDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const review of allReviews) {
          const score = review.score || review.rating;
          if (score >= 1 && score <= 5) {
            ratingDist[Math.round(score)]++;
          }
        }

        const total = allReviews.length;
        const result = {
          appId,
          appTitle: app.title,
          country,
          totalReviewed: total,
          sentiment: {
            positive,
            negative,
            neutral,
            positivePercent: Math.round((positive / total) * 100),
            negativePercent: Math.round((negative / total) * 100),
            neutralPercent: Math.round((neutral / total) * 100),
          },
          ratingDistribution: ratingDist,
          topComplaints: complaints.slice(0, 10),
          featureRequests: featureRequests.slice(0, 10),
          keywordInsights,
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.REVIEWS);

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

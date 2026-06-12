import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getRankingHistory } from "../cache/sqlite-cache.js";

// Position used for trend math when the app is not in the top 100.
// Keeps "ranked 80 -> not ranked" registering as a decline instead of a gap.
const NOT_RANKED_POSITION = 101;

interface DailyPoint {
  date: string;
  position: number | null;
  totalResults: number;
}

function toDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function registerGetRankingHistory(server: McpServer) {
  server.tool(
    "get_ranking_history",
    "Shows how an app's keyword rankings changed over time, based on snapshots saved locally by previous track_ranking runs. Returns per-keyword daily positions, best/worst, change, and trend (improving/declining/stable). Run track_ranking regularly to build history.",
    {
      appId: z
        .string()
        .min(1)
        .describe("App Store app ID or bundle ID (same value used in track_ranking)"),
      country: z
        .string()
        .min(2)
        .max(5)
        .default("tr")
        .describe("Country code"),
      days: z
        .number()
        .min(1)
        .max(365)
        .default(30)
        .describe("How many days of history to include"),
      keywords: z
        .array(z.string().min(1))
        .max(20)
        .optional()
        .describe("Optional keyword filter. Omit to include all tracked keywords."),
    },
    async ({ appId, country, days, keywords }) => {
      try {
        const rows = getRankingHistory(
          appId.trim().toLowerCase(),
          country.toLowerCase(),
          days,
          keywords
        );

        if (rows.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    appId,
                    country,
                    days,
                    totalSnapshots: 0,
                    message:
                      "No ranking history found for this app/country in the given period. Run track_ranking first; each run saves a snapshot.",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Group rows by keyword, then collapse to one point per day
        // (last snapshot of the day wins) to keep the output compact.
        const byKeyword = new Map<string, typeof rows>();
        for (const row of rows) {
          const list = byKeyword.get(row.keyword) ?? [];
          list.push(row);
          byKeyword.set(row.keyword, list);
        }

        const keywordHistories = [...byKeyword.entries()].map(
          ([keyword, kwRows]) => {
            const daily = new Map<string, DailyPoint>();
            for (const r of kwRows) {
              const date = toDate(r.recordedAt);
              daily.set(date, {
                date,
                position: r.position,
                totalResults: r.totalResults,
              });
            }
            const points = [...daily.values()];

            const ranked = points.filter((p) => p.position !== null);
            const bestPosition =
              ranked.length > 0
                ? Math.min(...ranked.map((p) => p.position!))
                : null;
            const worstPosition =
              ranked.length > 0
                ? Math.max(...ranked.map((p) => p.position!))
                : null;

            const first = points[0];
            const last = points[points.length - 1];
            const eff = (p: number | null) => p ?? NOT_RANKED_POSITION;

            let trend: string;
            let positionChange: number | null = null;
            if (points.length < 2) {
              trend = "insufficient-data";
            } else {
              positionChange = eff(first.position) - eff(last.position);
              trend =
                positionChange > 0
                  ? "improving"
                  : positionChange < 0
                  ? "declining"
                  : "stable";
            }

            return {
              keyword,
              snapshots: points,
              latestPosition: last.position,
              firstPosition: first.position,
              bestPosition,
              worstPosition,
              positionChange,
              trend,
            };
          }
        );

        // Best mover: largest positive change
        const movers = keywordHistories.filter(
          (k) => k.positionChange !== null && k.positionChange > 0
        );
        const bestMover =
          movers.length > 0
            ? movers.sort((a, b) => b.positionChange! - a.positionChange!)[0]
            : null;

        const result = {
          appId,
          country,
          days,
          totalSnapshots: rows.length,
          keywordsTracked: keywordHistories.length,
          summary: {
            improving: keywordHistories.filter((k) => k.trend === "improving")
              .length,
            declining: keywordHistories.filter((k) => k.trend === "declining")
              .length,
            stable: keywordHistories.filter((k) => k.trend === "stable").length,
            insufficientData: keywordHistories.filter(
              (k) => k.trend === "insufficient-data"
            ).length,
            bestMover: bestMover
              ? {
                  keyword: bestMover.keyword,
                  improvedBy: bestMover.positionChange,
                  latestPosition: bestMover.latestPosition,
                }
              : null,
          },
          keywords: keywordHistories,
        };

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );
}

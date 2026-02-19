import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig, getMetadata } from "../data-sources/app-store-connect.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL, CHAR_LIMITS } from "../utils/constants.js";

export function registerConnectGetMetadata(server: McpServer) {
  server.tool(
    "connect_get_metadata",
    "Get current ASO metadata for a specific locale from App Store Connect",
    {
      appId: z
        .string()
        .min(1)
        .describe("App Store Connect app ID (from connect_get_app)"),
      locale: z
        .string()
        .default("tr")
        .describe("Locale code — accepts both Apple format ('en-US') and country code ('us')"),
    },
    async ({ appId, locale }) => {
      const cacheKey = `connect-metadata:${appId}:${locale}`;
      const cached = getFromCache(cacheKey);
      if (cached) {
        return { content: [{ type: "text" as const, text: cached }] };
      }

      try {
        const config = loadConfig();
        if (!config) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: App Store Connect credentials not configured. Use connect_setup tool first.",
              },
            ],
            isError: true,
          };
        }

        const metadata = await getMetadata(config, appId, locale);

        const result = {
          metadata,
          characterLimits: {
            subtitle: {
              used: metadata.subtitleLength,
              max: CHAR_LIMITS.SUBTITLE,
              remaining: CHAR_LIMITS.SUBTITLE - metadata.subtitleLength,
            },
            keywords: {
              used: metadata.keywordsLength,
              max: CHAR_LIMITS.KEYWORD_FIELD,
              remaining: CHAR_LIMITS.KEYWORD_FIELD - metadata.keywordsLength,
            },
            description: {
              used: metadata.descriptionLength,
              max: CHAR_LIMITS.DESCRIPTION,
              remaining: CHAR_LIMITS.DESCRIPTION - metadata.descriptionLength,
            },
            promotionalText: {
              used: metadata.promotionalTextLength,
              max: CHAR_LIMITS.PROMOTIONAL_TEXT,
              remaining:
                CHAR_LIMITS.PROMOTIONAL_TEXT - metadata.promotionalTextLength,
            },
          },
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.CONNECT_METADATA);

        return { content: [{ type: "text" as const, text: resultText }] };
      } catch (error: any) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error.message}` },
          ],
          isError: true,
        };
      }
    }
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  loadConfig,
  listLocalizations,
} from "../data-sources/app-store-connect.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";

export function registerConnectListLocalizations(server: McpServer) {
  server.tool(
    "connect_list_localizations",
    "Bir uygulamanın tüm locale'lerini ve metadata durumlarını listele",
    {
      appId: z
        .string()
        .describe("App Store Connect app ID"),
    },
    async ({ appId }) => {
      const cacheKey = `connect-localizations:${appId}`;
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

        const localizations = await listLocalizations(config, appId);

        const result = {
          appId,
          totalLocales: localizations.length,
          localizations,
          summary: {
            withSubtitle: localizations.filter((l) => l.hasSubtitle).length,
            withKeywords: localizations.filter((l) => l.hasKeywords).length,
            withDescription: localizations.filter((l) => l.hasDescription).length,
            withPromotionalText: localizations.filter(
              (l) => l.hasPromotionalText
            ).length,
          },
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.CONNECT_LOCALIZATIONS);

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

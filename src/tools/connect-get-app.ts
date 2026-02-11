import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadConfig, getApp } from "../data-sources/app-store-connect.js";
import { getFromCache, setCache } from "../cache/sqlite-cache.js";
import { CACHE_TTL } from "../utils/constants.js";

export function registerConnectGetApp(server: McpServer) {
  server.tool(
    "connect_get_app",
    "Bundle ID ile uygulama bul, ASC ID ve versiyon durumunu göster",
    {
      bundleId: z
        .string()
        .describe("App bundle ID (e.g. 'com.spotify.client')"),
    },
    async ({ bundleId }) => {
      const cacheKey = `connect-app:${bundleId}`;
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

        const appInfo = await getApp(config, bundleId);

        const result = {
          app: appInfo,
          editableVersion: appInfo.versionId
            ? {
                id: appInfo.versionId,
                state: appInfo.versionState,
              }
            : null,
          note: appInfo.versionId
            ? "Editable version found (PREPARE_FOR_SUBMISSION)."
            : "No editable version found. Create a new version in App Store Connect to update metadata.",
        };

        const resultText = JSON.stringify(result, null, 2);
        setCache(cacheKey, resultText, CACHE_TTL.CONNECT_APP);

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

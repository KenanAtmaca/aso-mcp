import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clearCache, getCacheStats } from "../cache/sqlite-cache.js";

export function registerClearCache(server: McpServer) {
  server.tool(
    "clear_cache",
    "Clears the local ASO data cache. Use when you want fresh data from the App Store instead of cached results. Returns cache stats before and after clearing.",
    {},
    async () => {
      try {
        const before = getCacheStats();
        clearCache();
        const after = getCacheStats();

        const result = {
          status: "cleared",
          before: {
            totalEntries: before.totalEntries,
            expiredEntries: before.expiredEntries,
          },
          after: {
            totalEntries: after.totalEntries,
          },
          entriesRemoved: before.totalEntries - after.totalEntries,
          dbPath: before.dbPath,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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

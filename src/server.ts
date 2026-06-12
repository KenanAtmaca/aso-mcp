#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Phase 1 tools
import { registerSearchKeywords } from "./tools/search-keywords.js";
import { registerSuggestKeywords } from "./tools/suggest-keywords.js";
import { registerGetAppDetails } from "./tools/get-app-details.js";

// Phase 2 tools
import { registerAnalyzeCompetitors } from "./tools/analyze-competitors.js";
import { registerOptimizeMetadata } from "./tools/optimize-metadata.js";
import { registerAnalyzeReviews } from "./tools/analyze-reviews.js";
import { registerTrackRanking } from "./tools/track-ranking.js";
import { registerGetRankingHistory } from "./tools/get-ranking-history.js";
import { registerKeywordGap } from "./tools/keyword-gap.js";

// Phase 3 tools
import { registerLocalizedKeywords } from "./tools/localized-keywords.js";
import { registerGetAsoReport } from "./tools/get-aso-report.js";

// ASO Generation tools
import { registerDiscoverKeywords } from "./tools/discover-keywords.js";
import { registerGenerateAsoBrief } from "./tools/generate-aso-brief.js";

// Phase 5: App Store Connect tools
import { registerConnectSetup } from "./tools/connect-setup.js";
import { registerConnectGetApp } from "./tools/connect-get-app.js";
import { registerConnectGetMetadata } from "./tools/connect-get-metadata.js";
import { registerConnectUpdateMetadata } from "./tools/connect-update-metadata.js";
import { registerConnectListLocalizations } from "./tools/connect-list-localizations.js";
import { registerConnectBatchUpdateMetadata } from "./tools/connect-batch-update-metadata.js";

// Utility tools
import { registerClearCache } from "./tools/clear-cache.js";

import { initCache } from "./cache/sqlite-cache.js";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

const server = new McpServer({
  name: "aso-mcp",
  version: pkg.version,
});

// Initialize cache
initCache();

// Register Phase 1 tools
registerSearchKeywords(server);
registerSuggestKeywords(server);
registerGetAppDetails(server);

// Register Phase 2 tools
registerAnalyzeCompetitors(server);
registerOptimizeMetadata(server);
registerAnalyzeReviews(server);
registerTrackRanking(server);
registerGetRankingHistory(server);
registerKeywordGap(server);

// Register Phase 3 tools
registerLocalizedKeywords(server);
registerGetAsoReport(server);

// Register ASO Generation tools
registerDiscoverKeywords(server);
registerGenerateAsoBrief(server);

// Register Phase 5: App Store Connect tools
registerConnectSetup(server);
registerConnectGetApp(server);
registerConnectGetMetadata(server);
registerConnectUpdateMetadata(server);
registerConnectListLocalizations(server);
registerConnectBatchUpdateMetadata(server);

// Register Utility tools
registerClearCache(server);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown
const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";

// Phase 1 tools
import { registerSearchKeywords } from "./tools/search-keywords.js";
import { registerSuggestKeywords } from "./tools/suggest-keywords.js";
import { registerGetAppDetails } from "./tools/get-app-details.js";

// Phase 2 tools
import { registerAnalyzeCompetitors } from "./tools/analyze-competitors.js";
import { registerOptimizeMetadata } from "./tools/optimize-metadata.js";
import { registerAnalyzeReviews } from "./tools/analyze-reviews.js";
import { registerTrackRanking } from "./tools/track-ranking.js";
import { registerKeywordGap } from "./tools/keyword-gap.js";

// Phase 3 tools
import { registerLocalizedKeywords } from "./tools/localized-keywords.js";
import { registerGetAsoReport } from "./tools/get-aso-report.js";

// ASO Generation tools
import { registerDiscoverKeywords } from "./tools/discover-keywords.js";
import { registerGenerateAsoBrief } from "./tools/generate-aso-brief.js";

import { initCache } from "./cache/sqlite-cache.js";

dotenv.config();

const server = new McpServer({
  name: "aso-mcp",
  version: "1.0.0",
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
registerKeywordGap(server);

// Register Phase 3 tools
registerLocalizedKeywords(server);
registerGetAsoReport(server);

// Register ASO Generation tools
registerDiscoverKeywords(server);
registerGenerateAsoBrief(server);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

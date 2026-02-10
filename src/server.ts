#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";

// Faz 1 tools
import { registerSearchKeywords } from "./tools/search-keywords.js";
import { registerSuggestKeywords } from "./tools/suggest-keywords.js";
import { registerGetAppDetails } from "./tools/get-app-details.js";

// Faz 2 tools
import { registerAnalyzeCompetitors } from "./tools/analyze-competitors.js";
import { registerOptimizeMetadata } from "./tools/optimize-metadata.js";
import { registerAnalyzeReviews } from "./tools/analyze-reviews.js";
import { registerTrackRanking } from "./tools/track-ranking.js";
import { registerKeywordGap } from "./tools/keyword-gap.js";

// Faz 3 tools
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

// Cache'i baslat
initCache();

// Faz 1 tool'larini kaydet
registerSearchKeywords(server);
registerSuggestKeywords(server);
registerGetAppDetails(server);

// Faz 2 tool'larini kaydet
registerAnalyzeCompetitors(server);
registerOptimizeMetadata(server);
registerAnalyzeReviews(server);
registerTrackRanking(server);
registerKeywordGap(server);

// Faz 3 tool'larini kaydet
registerLocalizedKeywords(server);
registerGetAsoReport(server);

// ASO Generation tool'larini kaydet
registerDiscoverKeywords(server);
registerGenerateAsoBrief(server);

// Server'i baslat
const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run dev          # Run server directly with tsx (development)
npm run build        # Compile TypeScript to ./build + chmod 755
npm run start        # Run compiled server (production)
npm run inspect      # Open MCP Inspector in browser for interactive testing
npx tsx test.ts      # Full test suite (17 tests — cache, scoring, scraping, integration)
npx tsx test-generation.ts   # ASO generation scenario tests
npx tsx test-phase3.ts       # Localization & report tests
```

## Architecture

**MCP Server** serving 12 ASO tools over stdio transport. Tools are registered in `src/server.ts` grouped by phase.

**Data flow:** Tool Handler → SQLite Cache check → Rate Limiter (token bucket) → Data Source → Custom Scoring (fallback) → Cache result → Return JSON to client.

### Key Layers

- **`src/tools/`** — 12 MCP tool definitions. Each follows the pattern: Zod schema validation → cache lookup → data source calls → format result → cache + return. All return `{ content: [{ type: "text", text: JSON }] }`.
- **`src/data-sources/`** — Three data adapters:
  - `app-store.ts` — Wraps `app-store-scraper` (search, app details, reviews, ratings, suggestions, similar apps). All calls go through rate limiter.
  - `aso-scoring.ts` — Wraps `aso` npm package for traffic/difficulty scores. **Falls back automatically** to custom scoring when the aso package returns 503 (Apple API issue). Once fallback triggers, `asoAvailable` flag prevents further failed attempts.
  - `custom-scoring.ts` — Four scoring algorithms (visibility, competitive, opportunity, overall) independent of Apple APIs. Also provides `extractTitleKeywords()` with Turkish + English stop word filtering.
- **`src/cache/sqlite-cache.ts`** — SQLite with WAL mode. Cache keys are formatted as `type:param1:param2`. Auto-creates `./data/cache.db` directory.
- **`src/utils/`** — Constants (char limits: title 30, subtitle 30, keywords 100; cache TTLs; rate limits), token bucket rate limiter, formatters, country code localization.
- **`src/types/`** — `index.ts` for shared interfaces, `externals.d.ts` for `app-store-scraper` and `aso` module declarations (no @types packages exist).

### Tool Registration Pattern

```typescript
export function registerToolName(server: McpServer) {
  server.tool("tool_name", "description", { /* zod schema */ }, async (params) => {
    const cached = getFromCache(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: cached }] };
    try {
      // ... data source calls with rate limiting
      const resultText = JSON.stringify(result, null, 2);
      setCache(cacheKey, resultText, CACHE_TTL.KEYWORD_SCORES);
      return { content: [{ type: "text" as const, text: resultText }] };
    } catch (error: any) {
      return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
    }
  });
}
```

### Fallback Scoring

The `aso` npm package often gets 503 from Apple. When this happens, `aso-scoring.ts` automatically switches to fallback mode:
- Traffic: estimated from `Math.log10(avgReviews) * 1.8` of search results
- Difficulty: calculated via `calculateCompetitiveScore()` on top 10 apps
- The `asoAvailable` flag ensures no further failed API calls

## Important Constraints

- `app-store-scraper` latest version is **0.18.0** (not 0.19.0)
- `aso` latest version is **1.1.1** (not 2.2.0)
- Dev mode uses `tsx` (not `node --experimental-strip-types`) due to Node 24 ESM `.js` extension conflicts
- Import paths use `.js` extensions (TypeScript Node16 module resolution requirement)
- External modules `app-store-scraper` and `aso` are CommonJS — declared in `src/types/externals.d.ts`
- App Store character limits: Title 30, Subtitle 30, Keyword field 100 (comma-separated, no spaces)
- Rate limits: app-store-scraper 20 req/min, aso-scores 10 req/min
- Default country is `"tr"` (Turkey) across all tools

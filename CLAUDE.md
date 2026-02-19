# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Info

- **npm:** https://www.npmjs.com/package/aso-mcp
- **GitHub:** https://github.com/KenanAtmaca/aso-mcp
- **Install:** `npm install -g aso-mcp` or `npx aso-mcp`

## Build & Run Commands

```bash
npm run dev          # Run server directly with tsx (development)
npm run build        # Compile TypeScript to ./build + chmod 755
npm run start        # Run compiled server (production)
npm run inspect      # Open MCP Inspector in browser for interactive testing
npx tsx test.ts              # Core test suite (17 tests — cache, scoring, scraping, integration)
npx tsx test-generation.ts   # ASO generation scenario tests (8 tests)
npx tsx test-phase3.ts       # Localization & report tests (4 tests)
npx tsx test-connect.ts      # App Store Connect tests (9 tests — locale mapping + optional live API)
```

## Publishing

```bash
npm version patch|minor|major   # Bump version + git commit + tag
npm publish --access public     # Publish to npm (requires auth token)
```

## Architecture

**MCP Server** serving 19 tools over stdio transport. Tools are registered in `src/server.ts` grouped by phase.

**Data flow:** Tool Handler → Zod Validation (min/max constraints) → SQLite Cache check → Rate Limiter (token bucket + exponential backoff retry) → Data Source → Custom Scoring (fallback) → Cache result (max 5000 entries) → Return JSON to client.

### Tools (19)

| # | Tool | Phase | Description |
|---|------|-------|-------------|
| 1 | `search_keywords` | 1 | Keyword traffic/difficulty scores + competitor apps |
| 2 | `suggest_keywords` | 1 | Keyword suggestions (category, similar, competition strategies — parallel execution) |
| 3 | `get_app_details` | 1 | Full app metadata, ratings, reviews count |
| 4 | `analyze_competitors` | 2 | Top-ranking apps metadata comparison + keyword gap |
| 5 | `optimize_metadata` | 2 | Title/subtitle/keyword field optimization suggestions |
| 6 | `analyze_reviews` | 2 | Sentiment analysis (TR+EN with diacritic variants), complaints, feature requests |
| 7 | `track_ranking` | 2 | App ranking position for specific keywords (exact match) |
| 8 | `keyword_gap` | 2 | Keyword difference between two apps (batch scoring) |
| 9 | `localized_keywords` | 3 | Multi-country keyword score comparison (parallel per country) |
| 10 | `get_aso_report` | 3 | Comprehensive ASO report for an app |
| 11 | `discover_keywords` | Gen | Keyword discovery from scratch for new apps |
| 12 | `generate_aso_brief` | Gen | Complete ASO brief with title/subtitle/keyword suggestions |
| 13 | `connect_setup` | 5 | Configure & validate App Store Connect credentials |
| 14 | `connect_get_app` | 5 | Find app by bundle ID, get ASC ID + version state |
| 15 | `connect_get_metadata` | 5 | Read current metadata (name, subtitle, keywords, desc, supportUrl, marketingUrl) for a locale |
| 16 | `connect_update_metadata` | 5 | Write metadata with char limit validation, HTML entity sanitization, cache invalidation + before/after diff |
| 17 | `connect_batch_update_metadata` | 5 | Batch update metadata for multiple locales in one call (max 40 locales) |
| 18 | `connect_list_localizations` | 5 | List all locales and metadata completeness status |
| 19 | `clear_cache` | Util | Clear local SQLite cache |

### Key Layers

- **`src/tools/`** — 19 MCP tool definitions. Each follows the pattern: Zod schema validation (with min/max constraints) → cache lookup → data source calls → format result → cache + return. All return `{ content: [{ type: "text", text: JSON }] }`.
- **`src/data-sources/`** — Four data adapters:
  - `app-store.ts` — Wraps `app-store-scraper` (search, app details, reviews, ratings, suggestions, similar apps). All calls go through rate limiter.
  - `aso-scoring.ts` — Wraps `aso` npm package for traffic/difficulty scores. **Falls back automatically** to custom scoring when the aso package returns 503 (Apple API issue). Fallback has a 10-minute retry timer (`ASO_RETRY_INTERVAL_MS`) — after 10 minutes, the aso package is retried automatically. `batchGetScores()` processes keywords in parallel batches of 5.
  - `custom-scoring.ts` — Four scoring algorithms (visibility, competitive, opportunity, overall) independent of Apple APIs. Also provides `extractTitleKeywords()` with Turkish + English stop word filtering.
  - `app-store-connect.ts` — App Store Connect API client. JWT ES256 auth via `jsonwebtoken` with token caching (~18 min reuse, 2 min safety margin). Manages credentials from `~/.aso-mcp/connect-config.json` or env vars (`ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY_PATH`). Reads/writes metadata via App Info Localizations (name + subtitle) and App Store Version Localizations (keywords, description, promotionalText, whatsNew, supportUrl, marketingUrl). Includes `decodeHtmlEntities()` sanitization and editable appInfo selection logic.
- **`src/cache/sqlite-cache.ts`** — SQLite with WAL mode. Cache keys are formatted as `type:param1:param2`. Auto-creates `~/.aso-mcp/cache.db`. Max 5000 entries with automatic LRU eviction (`enforceSizeLimit()`). `deleteCache(pattern)` for selective LIKE-based invalidation (used by connect tools after writes).
- **`src/utils/`** — Constants (char limits, cache TTLs, rate limits), token bucket rate limiter with exponential backoff retry (3 retries for 429/503/network errors), formatters, country code localization with Apple locale mapping (`countryToLocale`/`localeToCountry`).
- **`src/types/`** — `index.ts` for shared interfaces (including Connect types with `name`/`nameLength` on `ConnectLocalization`), `externals.d.ts` for `app-store-scraper` and `aso` module declarations (no @types packages exist).

### Tool Registration Pattern

```typescript
export function registerToolName(server: McpServer) {
  server.tool("tool_name", "description", { /* zod schema with min/max */ }, async (params) => {
    const cached = getFromCache(cacheKey);
    if (cached) return { content: [{ type: "text" as const, text: cached }] };
    try {
      // ... data source calls with rate limiting + retry
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
- The `asoAvailable` flag prevents repeated API calls; resets after 10 minutes (`ASO_RETRY_INTERVAL_MS`) to retry

### Retry Mechanism

The rate limiter (`src/utils/rate-limiter.ts`) includes automatic retry with exponential backoff:
- Max 3 retries for retryable errors (429 Too Many Requests, 503 Service Unavailable, ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN)
- Backoff delays: 1s → 2s → 4s
- Non-retryable errors are thrown immediately

### Cache System

- SQLite with WAL mode at `~/.aso-mcp/cache.db`
- Max 5000 entries — oldest entries evicted when limit exceeded
- `deleteCache(pattern)` uses SQL LIKE for selective invalidation (e.g. `connect-metadata:${appId}:%`)
- `connect_update_metadata` and `connect_batch_update_metadata` automatically invalidate related cache entries after successful writes
- `generate_aso_brief` cache key includes `features` and `targetAudience` to prevent stale results

### App Store Connect Integration (Phase 5)

6 tools for end-to-end ASO metadata management. Credentials via env vars (`ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY_PATH`) or `~/.aso-mcp/connect-config.json`.

**Metadata locations in App Store Connect:**
- **App Info Localizations** (app level): name (title), subtitle
- **App Store Version Localizations** (version level): keywords, description, promotionalText, whatsNew, supportUrl, marketingUrl

`connect_update_metadata` behavior:
- **Supports `name` parameter:** App title can be set/updated per locale. When creating a new App Info Localization (locale doesn't exist yet), `name` is **required** by the Apple API. When updating an existing locale, `name` is optional.
- **Auto-create localizations:** If an App Info Localization or Version Localization doesn't exist for the target locale, it is created via `POST` automatically (e.g. for locales like it, ja, ko, pt-BR, ru that may not have an App Info Localization yet). If it exists, it is updated via `PATCH`.
- **Editable appInfo selection:** When fetching or creating App Info Localizations, the code fetches all `appInfos` and prefers the editable one (state != `READY_FOR_SALE`). This prevents 409 Conflict errors when creating new localizations on released apps that have both a live and editable appInfo.
- **HTML entity sanitization:** All text fields are automatically decoded before sending to the API (`&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`, `&quot;` → `"`, `&#39;` → `'`). This prevents accidental HTML-encoded characters from being stored in App Store Connect metadata.
- **Cache invalidation:** After successful update, `connect-metadata:` and `connect-localizations:` cache keys for the app are automatically deleted so subsequent reads return fresh data.
- **Safety:** char limit validation (using `CHAR_LIMITS.TITLE` for name, `CHAR_LIMITS.SUBTITLE` for subtitle) before API call, keywords space warning, PREPARE_FOR_SUBMISSION version requirement, before/after diff output (including name field).

`connect_batch_update_metadata` behavior:
- Takes an array of locale updates (max 40), validates all character limits upfront before any API calls.
- Processes locales sequentially to avoid API conflicts.
- Returns per-locale success/error status with overall summary (success/partial/failed).
- Invalidates cache after completion.

**JWT note:** Token is built manually with `iss`, `iat`, `exp`, `aud` in payload — do NOT use `jsonwebtoken`'s `issuer`/`audience`/`issuedAt` options (causes errors in v9). JWT tokens are cached for ~18 minutes (2 min safety margin before the 20-min expiry).

### Performance Optimizations

- **`localized_keywords`**: Countries processed in parallel via `Promise.all`, keywords scored via `batchGetScores`
- **`keyword_gap`**: All unique keywords scored in a single `batchGetScores` call instead of sequential loops
- **`suggest_keywords`**: All 3 strategies ("category", "similar", "competition") run in parallel when strategy="all"
- **`generate_aso_brief`**: Multi-market scoring uses `batchGetScores` for primary country
- **JWT caching**: Token reused for ~18 minutes, avoiding expensive ES256 signing on every API request

### Zod Validation

All tools enforce input constraints via Zod:
- `keyword`, `appId`, `niche`, `category` — `.min(1)` (non-empty)
- `country` — `.min(2).max(5)` (valid country code length)
- `num`, `competitors`, `pages` — `.min(1).max(N)` (bounded ranges)
- `keywords`, `features`, `targetKeywords` arrays — `.min(1).max(N)` with `.min(1)` on items
- `updates` array in batch tool — `.min(1).max(40)`

## Important Constraints

- `@modelcontextprotocol/sdk` pinned to **^1.26.0** (not `latest`)
- `app-store-scraper` latest version is **0.18.0** (not 0.19.0)
- `aso` latest version is **1.1.1** (not 2.2.0)
- `jsonwebtoken` version **^9.0.2** — used for App Store Connect JWT ES256 auth
- Dev mode uses `tsx` (not `node --experimental-strip-types`) due to Node 24 ESM `.js` extension conflicts
- Import paths use `.js` extensions (TypeScript Node16 module resolution requirement)
- External modules `app-store-scraper` and `aso` are CommonJS — declared in `src/types/externals.d.ts`
- App Store character limits: Title 30, Subtitle 30, Keyword field 100 (comma-separated, no spaces), Description 4000, Promotional Text 170, What's New 4000
- Rate limits: app-store-scraper 20 req/min, aso-scores 10 req/min, app-store-connect 200 req/min
- Retry: 3 attempts with exponential backoff (1s, 2s, 4s) for 429/503/network errors
- Cache: max 5000 entries, LRU eviction, selective invalidation via `deleteCache(pattern)`
- Default country is `"tr"` (Turkey) across all tools
- Server handles both `SIGINT` and `SIGTERM` for graceful shutdown
- All tool descriptions are in English (including Connect tools)
- License: MIT (LICENSE file at project root)

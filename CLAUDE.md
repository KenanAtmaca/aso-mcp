# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Info

- **npm:** https://www.npmjs.com/package/aso-mcp
- **GitHub:** https://github.com/KenanAtmaca/aso-mcp
- **Version:** 1.3.0
- **Install:** `npm install -g aso-mcp` or `npx aso-mcp`

The server reads its version dynamically from `package.json` at startup (`src/server.ts`), so MCP clients always see the published version without a manual sync step.

## Build & Run Commands

```bash
npm run dev          # Run server directly with tsx (development)
npm run build        # Compile TypeScript to ./build + chmod 755
npm run start        # Run compiled server (production)
npm run inspect      # Open MCP Inspector in browser for interactive testing
npx tsx test.ts              # Core test suite (17 tests: cache, scoring, scraping, integration)
npx tsx test-generation.ts   # ASO generation scenario tests (8 tests)
npx tsx test-phase3.ts       # Localization & report tests (4 tests)
npx tsx test-connect.ts      # App Store Connect tests (9 tests, locale mapping + optional live API)
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
| 2 | `suggest_keywords` | 1 | Keyword suggestions (category, similar, competition strategies, parallel execution). topOpportunities filtered via `isHighOpportunity` |
| 3 | `get_app_details` | 1 | Full app metadata, ratings, reviews count |
| 4 | `analyze_competitors` | 2 | Top-ranking apps comparison. Returns `commonKeywords`, `uniqueKeywords`, and `competitorCoverage` (per-app missing common analysis) |
| 5 | `optimize_metadata` | 2 | Title/subtitle/keyword field optimization suggestions |
| 6 | `analyze_reviews` | 2 | Sentiment analysis hybrid (keyword score + star-rating weight, fixes sarcastic reviews), complaints, feature requests |
| 7 | `track_ranking` | 2 | App ranking position for specific keywords. ID match cleanly distinguishes numeric track IDs from bundle IDs |
| 8 | `keyword_gap` | 2 | Keyword difference between two apps (batch scoring) |
| 9 | `localized_keywords` | 3 | Multi-country keyword score comparison (parallel per country). Cache key sorts keywords + countries |
| 10 | `get_aso_report` | 3 | Comprehensive ASO report for an app |
| 11 | `discover_keywords` | Gen | Keyword discovery from scratch for new apps. Brand stop list filters competitor names from suggestions |
| 12 | `generate_aso_brief` | Gen | Complete ASO brief: greedy keyword-field packer, concrete suggested title + subtitle with char counts, parallel multi-market scoring |
| 13 | `connect_setup` | 5 | Configure & validate App Store Connect credentials |
| 14 | `connect_get_app` | 5 | Find app by bundle ID, get ASC ID + version state |
| 15 | `connect_get_metadata` | 5 | Read current metadata (name, subtitle, keywords, desc, supportUrl, marketingUrl) for a locale. Returns `appInfoId` + `versionId` for reuse |
| 16 | `connect_update_metadata` | 5 | Write metadata with char limit validation, HTML entity sanitization, cache invalidation, before/after diff. Reuses parent IDs from getMetadata |
| 17 | `connect_batch_update_metadata` | 5 | Batch update metadata for multiple locales in one call (max 40 locales) |
| 18 | `connect_list_localizations` | 5 | List all locales and metadata completeness status |
| 19 | `clear_cache` | Util | Clear local SQLite cache |

### Key Layers

- **`src/tools/`**: 19 MCP tool definitions. Each follows the pattern: Zod schema validation (with min/max constraints) → cache lookup → data source calls → format result → cache + return. All return `{ content: [{ type: "text", text: JSON }] }`.
- **`src/data-sources/`**: Four data adapters:
  - `app-store.ts`: Wraps `app-store-scraper` (search, app details, reviews, ratings, suggestions, similar apps). All calls go through rate limiter. `getSuggestions(term, country)` passes the country to Apple's autocomplete (via X-Apple-Store-Front header) and normalizes the scraper's `[{ term }]` object results to plain strings (the scraper does NOT return `string[]` despite older assumptions).
  - `aso-scoring.ts`: Wraps `aso` npm package for traffic/difficulty scores. **Falls back automatically** to custom scoring when the aso package fails after retries. The try/catch is now placed OUTSIDE `withRateLimit` so 503/429 errors trigger the rate limiter's exponential backoff (1s + 2s + 4s) before fallback kicks in. Fallback has a 10-minute retry timer (`ASO_RETRY_INTERVAL_MS`); after 10 minutes the aso package is retried automatically. `batchGetScores()` processes keywords in parallel batches of 5. `fallbackSuggest()` resolves the app's real title before seeding autocomplete (no longer passes bundle IDs literally).
  - `custom-scoring.ts`: Four scoring algorithms (visibility, competitive, opportunity, overall) independent of Apple APIs. `extractTitleKeywords()` uses a Unicode-aware splitter (`[^\p{L}\p{N}]+`) that handles Turkish characters and App Store title symbols (·, ™, ®, ★, +, parens, em/en dashes), filters expanded stop words (app/free/pro/lite/premium/best/top/new + Turkish equivalents), and dedupes plural variants via `dedupeKeywords` + `canonicalKeyword` (trackers → tracker, kurslar → kurs, categories → category).
  - `app-store-connect.ts`: App Store Connect API client. JWT ES256 auth via `jsonwebtoken` with token caching (~18 min reuse, 2 min safety margin). Manages credentials from `~/.aso-mcp/connect-config.json` or env vars (`ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY_PATH`). Reads/writes metadata via App Info Localizations (name + subtitle) and App Store Version Localizations (keywords, description, promotionalText, whatsNew, supportUrl, marketingUrl). Includes `decodeHtmlEntities()` sanitization and editable appInfo selection logic. `getMetadata()` returns `appInfoId` + `versionId` so `updateMetadata()` can reuse them on create paths instead of re-fetching (saves 2 API calls per locale, multiplied across batch updates).
- **`src/cache/sqlite-cache.ts`**: SQLite with WAL mode. Cache keys are formatted as `type:param1:param2`. Auto-creates `~/.aso-mcp/cache.db`. Max 5000 entries with automatic LRU eviction (`enforceSizeLimit()`). Size check runs every 100 writes (`SIZE_CHECK_INTERVAL`) to keep the hot path fast. `deleteCache(pattern)` for selective LIKE-based invalidation (used by connect tools after writes).
- **`src/utils/`**: Constants (char limits, cache TTLs, rate limits), token bucket rate limiter with exponential backoff retry (3 retries for 429/503/network errors), formatters with central `OPPORTUNITY_TIERS` constants and `classifyOpportunity` / `isHighOpportunity` / `isMediumOrHigherOpportunity` helpers, country code localization with Apple locale mapping (`countryToLocale` throws on unknown 2-char codes; `localeToCountry`).
- **`src/types/`**: `index.ts` for shared interfaces (including `ConnectLocalization` with `appInfoId` + `versionId`, and the new `CompetitorCoverage` interface used by `analyze_competitors`), `externals.d.ts` for `app-store-scraper` and `aso` module declarations (no @types packages exist).

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

### Fallback Scoring (multi-signal)

The `aso` npm package often gets 503 from Apple. When this happens (after retries are exhausted), `aso-scoring.ts` automatically switches to fallback mode.

**Score source transparency:** `getScores` / `batchGetScores` return a `source` field (`"apple"` = real aso package scores, `"estimated"` = fallback). Scoring tools surface a top-level `scoresSource` (`apple` / `estimated` / `mixed`) plus a human-readable `scoresNote`, and cap the cache TTL at 600s when any score is estimated (helpers: `summarizeScoresSource`, `scoresCacheTtl`, `scoresSourceNote` in `formatters.ts`). This stops 1-hour caching of approximations and lets AI clients weigh estimated numbers appropriately.

- **Traffic** (multi-signal hybrid, max 10):
  - Result count signal (0-3): `Math.min(3, results.length / 6.67)`. More results returned = more popular keyword.
  - Top result strength (0-4): `Math.min(4, log10(top1Reviews) / 1.5)`. Blockbuster apps cluster around high-traffic terms.
  - Average review depth (0-3): `Math.min(3, log10(avgReviews) / 1.8)`.
- **Difficulty:** calculated via `calculateCompetitiveScore()` on top 10 apps.
- **Asoavailable flag** prevents repeated API calls; resets after 10 minutes (`ASO_RETRY_INTERVAL_MS`) to retry the upstream `aso` package.

### Retry Mechanism

The rate limiter (`src/utils/rate-limiter.ts`) includes automatic retry with exponential backoff:

- Token acquisition is serialized per source via a promise chain (`acquireToken`). Without it, N concurrent callers would all observe "no tokens", sleep the same deficit, and fire at once, bursting past the limit. This makes parallel tool internals (Promise.all over keywords/terms) safe.
- Max 3 retries for retryable errors (429 Too Many Requests, 503 Service Unavailable, ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN).
- Backoff delays: 1s, 2s, 4s.
- Non-retryable errors are thrown immediately.
- In `aso-scoring.ts`, the try/catch wraps `withRateLimit(...)` rather than living inside the async fn, so the rate limiter's retries actually fire on transient 503/429 before fallback scoring is engaged.

### Cache System

- SQLite with WAL mode at `~/.aso-mcp/cache.db`.
- Max 5000 entries; oldest entries (by `created_at`, FIFO) evicted when limit exceeded.
- Size enforcement throttled to once per 100 writes (was per-write before v1.2.0).
- `deleteCache(pattern)` uses SQL LIKE for selective invalidation (e.g. `connect-metadata:${appId}:%`).
- `connect_update_metadata` and `connect_batch_update_metadata` automatically invalidate related cache entries after successful writes.
- Estimated (fallback) scores cap the entry TTL at 600s via `scoresCacheTtl`.
- Tools that build composite cache keys normalize and sort mutable inputs to avoid order/case-sensitive misses:
  - Keywords, app IDs, and country codes are lowercased + trimmed in cache keys across scoring tools.
  - `discover_keywords` includes `featuresHash` (sorted) + `maxResults`.
  - `generate_aso_brief` includes `featuresHash` + `competitorsHash` + sorted `countriesHash` + `targetAudience`.
  - `localized_keywords`, `optimize_metadata`, and `track_ranking` sort their keyword arrays (and countries where applicable).

### App Store Connect Integration (Phase 5)

6 tools for end-to-end ASO metadata management. Credentials via env vars (`ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY_PATH`) or `~/.aso-mcp/connect-config.json`.

**Metadata locations in App Store Connect:**

- **App Info Localizations** (app level): name (title), subtitle.
- **App Store Version Localizations** (version level): keywords, description, promotionalText, whatsNew, supportUrl, marketingUrl.

`connect_update_metadata` behavior:

- **Supports `name` parameter:** App title can be set/updated per locale. When creating a new App Info Localization (locale doesn't exist yet), `name` is **required** by the Apple API. When updating an existing locale, `name` is optional.
- **Auto-create localizations:** If an App Info Localization or Version Localization doesn't exist for the target locale, it is created via `POST` automatically (e.g. for locales like it, ja, ko, pt-BR, ru that may not have an App Info Localization yet). If it exists, it is updated via `PATCH`.
- **Editable appInfo selection:** When fetching or creating App Info Localizations, the code fetches all `appInfos` and prefers the editable one (state != `READY_FOR_SALE`). This prevents 409 Conflict errors when creating new localizations on released apps that have both a live and editable appInfo.
- **Parent ID reuse:** `getMetadata` returns the resolved `appInfoId` and `versionId` (not just the localization IDs). When `updateMetadata` needs to create a new localization, it reuses these parent IDs instead of calling `getAppInfoId` / `getEditableVersionId` again, eliminating redundant `appInfos` and `appStoreVersions` round-trips.
- **HTML entity sanitization:** All text fields are automatically decoded before sending to the API (`&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`, `&quot;` → `"`, `&#39;` → `'`). `&amp;` is decoded last so inputs like `&amp;lt;` are not double-decoded. This prevents accidental HTML-encoded characters from being stored in App Store Connect metadata.
- **Cache invalidation:** After successful update, `connect-metadata:` and `connect-localizations:` cache keys for the app are automatically deleted so subsequent reads return fresh data.
- **Safety:** char limit validation (using `CHAR_LIMITS.TITLE` for name, `CHAR_LIMITS.SUBTITLE` for subtitle) before API call, keywords space warning, PREPARE_FOR_SUBMISSION version requirement, before/after diff output (including name field).

`connect_batch_update_metadata` behavior:

- Takes an array of locale updates (max 40), validates all character limits upfront before any API calls.
- Processes locales sequentially to avoid API conflicts.
- Returns per-locale success/error status with overall summary (success/partial/failed).
- Invalidates cache after completion.

**JWT note:** Token is built manually with `iss`, `iat`, `exp`, `aud` in payload. Do NOT use `jsonwebtoken`'s `issuer`/`audience`/`issuedAt` options (causes errors in v9). JWT tokens are cached for ~18 minutes (2 min safety margin before the 20-min expiry).

**Locale resolution:** `countryToLocale()` throws an explicit error on unknown 2-char codes (rather than silently passing them to App Store Connect, which would return opaque 4xx errors). Acceptable inputs are full Apple locales like `en-US`, `zh-Hans`, or supported short codes like `tr`, `us`, `de`.

### ASO Quality Layer

These helpers shape what `discover_keywords`, `generate_aso_brief`, and `analyze_competitors` actually return:

- **`canonicalKeyword(kw)` / `dedupeKeywords(list)`** in `custom-scoring.ts`: collapse plural variants because App Store search treats `tracker` and `trackers` as the same index; suggesting both wastes a keyword-field slot. Conservative rules only: `length > 4` for plain `-s`, plus `-ies → -y`, `-ches/-shes/-xes/-sses` strip, Turkish `-lar/-ler` strip. Avoids false positives like `us`, `ios`, `kurs`, `analysis`.
- **Brand stop list** in `discover_keywords.ts`: builds a per-search Set from each top-ranking app's title prefix (single word before the first separator) and single-word developer name (excluding company suffixes like `inc`, `llc`, `gmbh`). Removes those tokens from the keyword pool so suggestions for a NEW app don't include trademarked competitor names like `spotify` or `adobe`.
- **`packKeywordField(candidates, maxLength, excludedTokens)`** in `generate-aso-brief.ts`: greedy-packs the 100-char keyword field by splitting multi-word candidates into individual tokens (each indexed separately by Apple), excluding anything already used in title/subtitle (those slots are wasted), deduping, and stripping spaces. Returns the actual ready-to-paste string plus `used`, `unused`, and `excluded` lists for transparency.
- **Concrete title + subtitle suggestions** in `generate-aso-brief.ts`: greedy-fits the highest-traffic keywords after the app name into the 30-char title limit and into the 30-char subtitle limit, then surfaces both literal strings + char counts in `metadataGuidelines` and the `actionPlan` so AI clients can copy-paste directly.
- **Hybrid sentiment** in `analyze-reviews.ts`: `analyzeSentiment(text, rating?)` weights the star rating equivalent to two strong sentiment words. A 1-star review saying `harika çalışıyor` (sarcasm) gets the rating's negative signal added to the keyword score and is correctly classified as negative. Falls back to pure keyword count when no rating is provided.
- **`OPPORTUNITY_TIERS`** in `formatters.ts`: HIGH=7, MEDIUM=5, LOW=3. Replaces scattered ad-hoc thresholds. `classifyOpportunity(score)` returns `{ tier, label }`; `isHighOpportunity` and `isMediumOrHigherOpportunity` are filter shorthands used across `discover_keywords`, `generate_aso_brief`, and `suggest_keywords`.

### Performance Optimizations

- **`localized_keywords`**: Countries processed in parallel via `Promise.all`, keywords scored via `batchGetScores`.
- **`keyword_gap`**: All unique keywords scored in a single `batchGetScores` call instead of sequential loops.
- **`suggest_keywords`**: All 3 strategies (`category`, `similar`, `competition`) run in parallel when strategy=`all`.
- **`generate_aso_brief`**: Multi-market scoring runs all countries in parallel via `Promise.all` + `batchGetScores` (was sequential through v1.1.0). Search-term scans, autocomplete fetches, and known-competitor lookups also run in parallel.
- **`discover_keywords`**: Search-term scans and autocomplete suggestion fetches run in parallel.
- **`track_ranking`**: All keyword searches run in parallel (rate limiter queues the actual requests).
- **`analyze_reviews`**: Review pages fetched in parallel; failed pages contribute nothing instead of aborting.
- **Connect `getMetadata`**: The appInfo chain and the version chain (2 requests each) run in parallel, halving read latency per locale.
- **`getMetadata` parent ID reuse**: `updateMetadata` skips the second `appInfos` and `appStoreVersions` lookups when creating new localizations, saving 2 API calls per locale (matters for `connect_batch_update_metadata` of up to 40 locales).
- **JWT caching**: Token reused for ~18 minutes, avoiding expensive ES256 signing on every API request.
- **Cache size enforcement throttle**: `setCache` only counts rows once per 100 writes.

### Zod Validation

All tools enforce input constraints via Zod:

- `keyword`, `appId`, `niche`, `category`: `.min(1)` (non-empty).
- `country`: `.min(2).max(5)` (valid country code length).
- `num`, `competitors`, `pages`: `.min(1).max(N)` (bounded ranges).
- `keywords`, `features`, `targetKeywords` arrays: `.min(1).max(N)` with `.min(1)` on items.
- `updates` array in batch tool: `.min(1).max(40)`.

## Important Constraints

- `@modelcontextprotocol/sdk` pinned to **^1.26.0** (not `latest`).
- `app-store-scraper` latest version is **0.18.0** (not 0.19.0).
- `aso` latest version is **1.1.1** (not 2.2.0).
- `jsonwebtoken` version **^9.0.3**, used for App Store Connect JWT ES256 auth.
- `zod` version **^4.3.6**, schema validation for all tool inputs.
- `better-sqlite3` version **^12.6.2**, SQLite cache with WAL mode.
- `dotenv` version **^16.4.0**, environment variable loading.
- Node.js **>= 22.0.0** required (engine constraint in package.json).
- Server version is read at runtime from `package.json` via `readFileSync`. Do NOT hardcode in `src/server.ts`.
- Dev mode uses `tsx` (not `node --experimental-strip-types`) due to Node 24 ESM `.js` extension conflicts.
- Import paths use `.js` extensions (TypeScript Node16 module resolution requirement).
- External modules `app-store-scraper` and `aso` are CommonJS, declared in `src/types/externals.d.ts`.
- App Store character limits: Title 30, Subtitle 30, Keyword field 100 (comma-separated, no spaces), Description 4000, Promotional Text 170, What's New 4000.
- Rate limits: app-store-scraper 20 req/min, aso-scores 10 req/min, app-store-connect 200 req/min. Token acquisition is serialized per source (no concurrent burst past the limit).
- Retry: 3 attempts with exponential backoff (1s, 2s, 4s) for 429/503/network errors. The `aso-scoring.ts` try/catch is placed OUTSIDE `withRateLimit` so retries actually run before fallback engages.
- Cache: max 5000 entries, oldest-first (FIFO) eviction, size enforcement throttled to every 100 writes, selective invalidation via `deleteCache(pattern)`. Estimated-score results capped at 600s TTL.
- Default country is `"tr"` (Turkey) across all tools.
- Server handles both `SIGINT` and `SIGTERM` for graceful shutdown.
- All tool descriptions are in English (including Connect tools).
- License: MIT (LICENSE file at project root).
- **Style:** No em dash (U+2014) or en dash (U+2013) anywhere in source, comments, or strings. Use period, colon, parentheses, or rewrite. Verify with `grep -rnP "\x{2014}|\x{2013}" src/ README.md` before commit.

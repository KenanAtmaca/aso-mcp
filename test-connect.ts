/**
 * ASO MCP Server — App Store Connect Test Suite
 * Tests locale mapping, constants, and optionally live API calls.
 *
 * Run (no credentials needed):
 *   npx tsx test-connect.ts
 *
 * Run with credentials:
 *   ASC_ISSUER_ID=X ASC_KEY_ID=Y ASC_PRIVATE_KEY_PATH=Z ASC_TEST_BUNDLE_ID=com.app.id npx tsx test-connect.ts
 */

import { countryToLocale, localeToCountry, COUNTRY_TO_LOCALE } from "./src/utils/localization.js";
import { CACHE_TTL, RATE_LIMITS, CHAR_LIMITS } from "./src/utils/constants.js";
import { initCache } from "./src/cache/sqlite-cache.js";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";
const SKIP = "\x1b[33m⊘\x1b[0m";

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${FAIL} ${name} — ${err.message}`);
    failed++;
  }
}

function skip(name: string, reason: string) {
  console.log(`  ${SKIP} ${name} — ${reason}`);
  skipped++;
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log("\n🔌 ASO MCP Server — App Store Connect Test Suite\n");

  initCache();

  // ─── 1. Locale Mapping ───
  console.log("🌍 Locale Mapping");

  await test("countryToLocale — basic mapping", async () => {
    assert(countryToLocale("us") === "en-US", `Expected en-US, got ${countryToLocale("us")}`);
    assert(countryToLocale("tr") === "tr", `Expected tr, got ${countryToLocale("tr")}`);
    assert(countryToLocale("de") === "de-DE", `Expected de-DE, got ${countryToLocale("de")}`);
    assert(countryToLocale("jp") === "ja", `Expected ja, got ${countryToLocale("jp")}`);
    assert(countryToLocale("br") === "pt-BR", `Expected pt-BR, got ${countryToLocale("br")}`);
    assert(countryToLocale("cn") === "zh-Hans", `Expected zh-Hans, got ${countryToLocale("cn")}`);
  });

  await test("countryToLocale — Apple locale passthrough", async () => {
    assert(countryToLocale("en-US") === "en-US", "Should pass through en-US");
    assert(countryToLocale("zh-Hans") === "zh-Hans", "Should pass through zh-Hans");
    assert(countryToLocale("pt-BR") === "pt-BR", "Should pass through pt-BR");
  });

  await test("countryToLocale — unknown country fallback", async () => {
    assert(countryToLocale("zz") === "zz", "Unknown country should return as-is");
  });

  await test("localeToCountry — reverse mapping", async () => {
    assert(localeToCountry("en-US") === "us", `Expected us, got ${localeToCountry("en-US")}`);
    assert(localeToCountry("de-DE") === "de", `Expected de, got ${localeToCountry("de-DE")}`);
    assert(localeToCountry("ja") === "jp", `Expected jp, got ${localeToCountry("ja")}`);
  });

  await test("COUNTRY_TO_LOCALE — has 20 entries", async () => {
    const count = Object.keys(COUNTRY_TO_LOCALE).length;
    assert(count === 20, `Expected 20 entries, got ${count}`);
  });

  // ─── 2. Constants ───
  console.log("\n📐 Constants");

  await test("CACHE_TTL — Connect values exist", async () => {
    assert(CACHE_TTL.CONNECT_APP === 1800, `Expected 1800, got ${CACHE_TTL.CONNECT_APP}`);
    assert(CACHE_TTL.CONNECT_METADATA === 300, `Expected 300, got ${CACHE_TTL.CONNECT_METADATA}`);
    assert(CACHE_TTL.CONNECT_LOCALIZATIONS === 600, `Expected 600, got ${CACHE_TTL.CONNECT_LOCALIZATIONS}`);
  });

  await test("RATE_LIMITS — Connect rate limit exists", async () => {
    const rl = RATE_LIMITS["app-store-connect"];
    assert(rl.maxRequests === 200, `Expected 200 max requests, got ${rl.maxRequests}`);
    assert(rl.windowMs === 60_000, `Expected 60000 window, got ${rl.windowMs}`);
  });

  await test("CHAR_LIMITS — new fields exist", async () => {
    assert(CHAR_LIMITS.DESCRIPTION === 4000, `Expected 4000, got ${CHAR_LIMITS.DESCRIPTION}`);
    assert(CHAR_LIMITS.PROMOTIONAL_TEXT === 170, `Expected 170, got ${CHAR_LIMITS.PROMOTIONAL_TEXT}`);
    assert(CHAR_LIMITS.WHATS_NEW === 4000, `Expected 4000, got ${CHAR_LIMITS.WHATS_NEW}`);
  });

  await test("CHAR_LIMITS — existing fields preserved", async () => {
    assert(CHAR_LIMITS.TITLE === 30, `Expected 30, got ${CHAR_LIMITS.TITLE}`);
    assert(CHAR_LIMITS.SUBTITLE === 30, `Expected 30, got ${CHAR_LIMITS.SUBTITLE}`);
    assert(CHAR_LIMITS.KEYWORD_FIELD === 100, `Expected 100, got ${CHAR_LIMITS.KEYWORD_FIELD}`);
  });

  // ─── 3. Live API Tests (credential-dependent) ───
  const hasCredentials =
    process.env.ASC_ISSUER_ID &&
    process.env.ASC_KEY_ID &&
    process.env.ASC_PRIVATE_KEY_PATH;
  const testBundleId = process.env.ASC_TEST_BUNDLE_ID;

  console.log("\n🔑 Live API Tests");

  if (!hasCredentials) {
    skip("validateCredentials", "No ASC credentials in env");
    skip("getApp", "No ASC credentials in env");
    skip("getMetadata", "No ASC credentials in env");
    skip("listLocalizations", "No ASC credentials in env");
  } else {
    const {
      loadConfig,
      validateCredentials,
      getApp,
      getMetadata,
      listLocalizations,
    } = await import("./src/data-sources/app-store-connect.js");

    const config = loadConfig()!;

    await test("validateCredentials — test API call", async () => {
      const valid = await validateCredentials(config);
      assert(valid === true, "Credentials should be valid");
    });

    if (!testBundleId) {
      skip("getApp", "No ASC_TEST_BUNDLE_ID in env");
      skip("getMetadata", "No ASC_TEST_BUNDLE_ID in env");
      skip("listLocalizations", "No ASC_TEST_BUNDLE_ID in env");
    } else {
      let appId: string;

      await test(`getApp — ${testBundleId}`, async () => {
        const app = await getApp(config, testBundleId);
        assert(!!app.id, "App should have an ID");
        assert(app.bundleId === testBundleId, `Bundle ID should match`);
        appId = app.id;
        console.log(`    ${INFO} App: ${app.name} (${app.id}), version state: ${app.versionState ?? "none"}`);
      });

      await test("getMetadata — primary locale", async () => {
        const metadata = await getMetadata(config, appId, "tr");
        assert(!!metadata.locale, "Should have locale");
        console.log(`    ${INFO} Locale: ${metadata.locale}, subtitle: ${metadata.subtitle ?? "(empty)"}, keywords: ${metadata.keywordsLength} chars`);
      });

      await test("listLocalizations", async () => {
        const locs = await listLocalizations(config, appId);
        assert(Array.isArray(locs), "Should return array");
        assert(locs.length > 0, "Should have at least one locale");
        console.log(`    ${INFO} ${locs.length} locales: ${locs.map((l) => l.locale).join(", ")}`);
      });
    }
  }

  // ─── Summary ───
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

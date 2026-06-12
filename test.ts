/**
 * ASO MCP Server - Manual Test Script
 * Tests all tool data sources directly.
 *
 * Run: npx tsx test.ts
 */

import { searchApps, getAppDetails, getReviews, getSuggestions } from "./src/data-sources/app-store.js";
import { getScores, suggestKeywords } from "./src/data-sources/aso-scoring.js";
import {
  initCache,
  getFromCache,
  setCache,
  getCacheStats,
  recordRankingSnapshots,
  getRankingHistory,
} from "./src/cache/sqlite-cache.js";
import { extractTitleKeywords, calculateCompetitiveScore, calculateOpportunityScore } from "./src/data-sources/custom-scoring.js";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";
const WARN = "\x1b[33m⚠\x1b[0m";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${FAIL} ${name} - ${err.message}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log("\n🔧 ASO MCP Server - Full Test Suite\n");

  // ─── 1. Cache ───
  console.log("📦 Cache Layer");
  initCache();

  await test("Cache init & stats", async () => {
    const stats = getCacheStats();
    assert(typeof stats.totalEntries === "number", "totalEntries should exist");
  });

  await test("Cache set & get", async () => {
    setCache("test-key", "test-value", 60);
    const val = getFromCache("test-key");
    assert(val === "test-value", `Expected: test-value, Got: ${val}`);
  });

  await test("Ranking history record & read", async () => {
    const testAppId = `test-history-app-${Date.now()}`;
    recordRankingSnapshots(testAppId, "tr", [
      { keyword: "Test Keyword", position: 12, totalResults: 100, topApp: "Top App" },
      { keyword: "other kw", position: null, totalResults: 80, topApp: "Top App 2" },
    ]);
    const rows = getRankingHistory(testAppId, "tr", 1);
    assert(rows.length === 2, `Expected 2 rows, got ${rows.length}`);
    const kw = rows.find((r) => r.keyword === "test keyword");
    assert(kw !== undefined, "Keyword should be stored lowercased");
    assert(kw!.position === 12, `Expected position 12, got ${kw!.position}`);
    const filtered = getRankingHistory(testAppId, "tr", 1, ["Test Keyword"]);
    assert(filtered.length === 1, `Keyword filter should return 1 row, got ${filtered.length}`);
    const otherCountry = getRankingHistory(testAppId, "us", 1);
    assert(otherCountry.length === 0, "Different country should have no history");
    console.log(`    ${INFO} 2 snapshots recorded, filter + country isolation OK`);
  });

  // ─── 2. Custom Scoring ───
  console.log("\n🧮 Custom Scoring");

  await test("extractTitleKeywords", async () => {
    const kws = extractTitleKeywords("Spotify: Muzik ve Podcast");
    assert(kws.length > 0, "Keywords should be extracted");
    assert(kws.includes("spotify"), `spotify should be found, got: ${kws}`);
  });

  await test("calculateCompetitiveScore", async () => {
    const score = calculateCompetitiveScore([
      { rating: 4.5, reviews: 50000, free: true },
      { rating: 4.2, reviews: 30000, free: true },
      { rating: 3.8, reviews: 10000, free: false },
    ]);
    assert(score >= 0 && score <= 10, `Score should be 0-10: ${score}`);
    console.log(`    ${INFO} Competitive score: ${score.toFixed(1)}`);
  });

  await test("calculateOpportunityScore", async () => {
    const high = calculateOpportunityScore(8, 3);
    const low = calculateOpportunityScore(2, 9);
    assert(high > low, `High opportunity > low opportunity: ${high} vs ${low}`);
    console.log(`    ${INFO} High opp: ${high.toFixed(1)}, Low opp: ${low.toFixed(1)}`);
  });

  // ─── 3. App Store Scraper ───
  console.log("\n🍎 App Store Scraper");

  await test("searchApps - 'fitness' TR", async () => {
    const apps = await searchApps("fitness", "tr", 5);
    assert(Array.isArray(apps), "Should return array");
    assert(apps.length > 0, "Should have results");
    console.log(`    ${INFO} ${apps.length} apps found - First: "${(apps[0] as any).title}"`);
  });

  await test("getAppDetails - Spotify (bundle ID)", async () => {
    const app = await getAppDetails("com.spotify.client", "tr");
    assert(app.title != null, "title should exist");
    assert(app.score > 0, "rating should be > 0");
    console.log(`    ${INFO} ${app.title} - Rating: ${app.score} - ${app.reviews} reviews`);
  });

  await test("getAppDetails - numeric ID (Spotify: 324684580)", async () => {
    const app = await getAppDetails("324684580", "tr");
    assert(app.title != null, "title should exist");
    console.log(`    ${INFO} ${app.title}`);
  });

  await test("getReviews - Spotify TR", async () => {
    const reviews = await getReviews(324684580, "tr", 1);
    assert(Array.isArray(reviews), "Should return array");
    console.log(`    ${INFO} ${reviews.length} reviews fetched`);
    if (reviews.length > 0) {
      const r = reviews[0];
      console.log(`    ${INFO} Sample: "${(r.title || r.text || "").slice(0, 60)}..." Rating:${r.score}`);
    }
  });

  await test("getSuggestions - 'music'", async () => {
    const suggestions = await getSuggestions("music");
    assert(Array.isArray(suggestions), "Should return array");
    assert(suggestions.length > 0, "Should have suggestions");
    console.log(`    ${INFO} ${suggestions.length} suggestions: ${suggestions.slice(0, 5).join(", ")}`);
  });

  // ─── 4. ASO Scoring (with fallback) ───
  console.log("\n📊 ASO Scoring (aso package or fallback)");

  await test("getScores - 'fitness tracker' US", async () => {
    const scores = await getScores("fitness tracker", "us");
    assert(typeof scores.traffic === "number", "traffic should exist");
    assert(typeof scores.difficulty === "number", "difficulty should exist");
    assert(scores.traffic >= 0, "traffic should be >= 0");
    assert(scores.difficulty >= 0, "difficulty should be >= 0");
    console.log(`    ${INFO} Traffic: ${scores.traffic}, Difficulty: ${scores.difficulty}`);
  });

  await test("getScores - 'muzik' TR", async () => {
    const scores = await getScores("muzik", "tr");
    assert(typeof scores.traffic === "number", "traffic should exist");
    console.log(`    ${INFO} Traffic: ${scores.traffic}, Difficulty: ${scores.difficulty}`);
  });

  await test("getScores - 'photo editor' US", async () => {
    const scores = await getScores("photo editor", "us");
    assert(scores.traffic > 0, "traffic > 0 expected");
    console.log(`    ${INFO} Traffic: ${scores.traffic}, Difficulty: ${scores.difficulty}`);
  });

  await test("suggestKeywords - Spotify (competition)", async () => {
    const keywords = await suggestKeywords("324684580", "competition", "tr", 10);
    assert(Array.isArray(keywords), "Should return array");
    console.log(`    ${INFO} ${keywords.length} keywords suggested: ${keywords.slice(0, 5).join(", ")}`);
  });

  // ─── 5. Integration: Tool Scenarios ───
  console.log("\n🔗 Integration Scenarios");

  await test("Scenario: Keyword research (search + score)", async () => {
    const keyword = "meditation";
    const apps = await searchApps(keyword, "us", 5);
    const scores = await getScores(keyword, "us");
    assert(apps.length > 0, "Should have app results");
    assert(typeof scores.traffic === "number", "Should have scores");
    const competitive = calculateCompetitiveScore(
      apps.map((a: any) => ({
        rating: a.score || 0,
        reviews: a.reviews || 0,
        free: a.free ?? true,
      }))
    );
    console.log(`    ${INFO} "${keyword}": ${apps.length} apps, traffic=${scores.traffic}, difficulty=${scores.difficulty}, competitive=${competitive.toFixed(1)}`);
  });

  await test("Scenario: App detail + review analysis", async () => {
    const app = await getAppDetails("com.spotify.client", "us");
    const reviews = await getReviews(app.id, "us", 1);
    assert(app.title != null, "App info should exist");
    assert(reviews.length > 0, "Should have reviews");

    // Simple sentiment
    let pos = 0, neg = 0;
    for (const r of reviews) {
      if (r.score >= 4) pos++;
      else if (r.score <= 2) neg++;
    }
    console.log(`    ${INFO} ${app.title}: ${reviews.length} reviews, ${pos} positive, ${neg} negative`);
  });

  await test("Scenario: Keyword gap (two app comparison)", async () => {
    const app1 = await getAppDetails("com.spotify.client", "us");
    const app2 = await getAppDetails("com.apple.music", "us");
    const kw1 = extractTitleKeywords(app1.title || "");
    const kw2 = extractTitleKeywords(app2.title || "");
    const set1 = new Set(kw1);
    const set2 = new Set(kw2);
    const shared = kw1.filter((k: string) => set2.has(k));
    const onlyApp1 = kw1.filter((k: string) => !set2.has(k));
    const onlyApp2 = kw2.filter((k: string) => !set1.has(k));
    console.log(`    ${INFO} ${app1.title} vs ${app2.title}`);
    console.log(`    ${INFO} Shared: [${shared.join(", ")}] | Only 1: [${onlyApp1.join(", ")}] | Only 2: [${onlyApp2.join(", ")}]`);
  });

  // ─── Result ───
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${PASS} ${passed} tests passed`);
  if (failed > 0) console.log(`  ${FAIL} ${failed} tests failed`);
  else console.log(`  🎉 All tests passed!`);
  console.log(`${"─".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

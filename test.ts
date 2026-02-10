/**
 * ASO MCP Server — Manuel Test Script
 * Tum tool'larin data source'larini dogrudan test eder.
 *
 * Calistir: npx tsx test.ts
 */

import { searchApps, getAppDetails, getReviews, getSuggestions } from "./src/data-sources/app-store.js";
import { getScores, suggestKeywords } from "./src/data-sources/aso-scoring.js";
import { initCache, getFromCache, setCache, getCacheStats } from "./src/cache/sqlite-cache.js";
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
    console.log(`  ${FAIL} ${name} — ${err.message}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log("\n🔧 ASO MCP Server — Full Test Suite\n");

  // ─── 1. Cache ───
  console.log("📦 Cache Layer");
  initCache();

  await test("Cache init & stats", async () => {
    const stats = getCacheStats();
    assert(typeof stats.totalEntries === "number", "totalEntries olmali");
  });

  await test("Cache set & get", async () => {
    setCache("test-key", "test-value", 60);
    const val = getFromCache("test-key");
    assert(val === "test-value", `Beklenen: test-value, Gelen: ${val}`);
  });

  // ─── 2. Custom Scoring ───
  console.log("\n🧮 Custom Scoring");

  await test("extractTitleKeywords", async () => {
    const kws = extractTitleKeywords("Spotify: Muzik ve Podcast");
    assert(kws.length > 0, "Keyword cikarilmali");
    assert(kws.includes("spotify"), `spotify bulunmali, gelen: ${kws}`);
  });

  await test("calculateCompetitiveScore", async () => {
    const score = calculateCompetitiveScore([
      { rating: 4.5, reviews: 50000, free: true },
      { rating: 4.2, reviews: 30000, free: true },
      { rating: 3.8, reviews: 10000, free: false },
    ]);
    assert(score >= 0 && score <= 10, `Skor 0-10 arasi olmali: ${score}`);
    console.log(`    ${INFO} Competitive score: ${score.toFixed(1)}`);
  });

  await test("calculateOpportunityScore", async () => {
    const high = calculateOpportunityScore(8, 3);
    const low = calculateOpportunityScore(2, 9);
    assert(high > low, `Yuksek firsat > dusuk firsat: ${high} vs ${low}`);
    console.log(`    ${INFO} High opp: ${high.toFixed(1)}, Low opp: ${low.toFixed(1)}`);
  });

  // ─── 3. App Store Scraper ───
  console.log("\n🍎 App Store Scraper");

  await test("searchApps — 'fitness' TR", async () => {
    const apps = await searchApps("fitness", "tr", 5);
    assert(Array.isArray(apps), "Array donmeli");
    assert(apps.length > 0, "Sonuc olmali");
    console.log(`    ${INFO} ${apps.length} app bulundu — Ilk: "${(apps[0] as any).title}"`);
  });

  await test("getAppDetails — Spotify (bundle ID)", async () => {
    const app = await getAppDetails("com.spotify.client", "tr");
    assert(app.title != null, "title olmali");
    assert(app.score > 0, "rating > 0 olmali");
    console.log(`    ${INFO} ${app.title} — Rating: ${app.score} — ${app.reviews} yorum`);
  });

  await test("getAppDetails — numeric ID (Spotify: 324684580)", async () => {
    const app = await getAppDetails("324684580", "tr");
    assert(app.title != null, "title olmali");
    console.log(`    ${INFO} ${app.title}`);
  });

  await test("getReviews — Spotify TR", async () => {
    const reviews = await getReviews(324684580, "tr", 1);
    assert(Array.isArray(reviews), "Array donmeli");
    console.log(`    ${INFO} ${reviews.length} yorum cekildi`);
    if (reviews.length > 0) {
      const r = reviews[0];
      console.log(`    ${INFO} Ornek: "${(r.title || r.text || "").slice(0, 60)}..." Rating:${r.score}`);
    }
  });

  await test("getSuggestions — 'music'", async () => {
    const suggestions = await getSuggestions("music");
    assert(Array.isArray(suggestions), "Array donmeli");
    assert(suggestions.length > 0, "Oneri olmali");
    console.log(`    ${INFO} ${suggestions.length} oneri: ${suggestions.slice(0, 5).join(", ")}`);
  });

  // ─── 4. ASO Scoring (with fallback) ───
  console.log("\n📊 ASO Scoring (aso paketi veya fallback)");

  await test("getScores — 'fitness tracker' US", async () => {
    const scores = await getScores("fitness tracker", "us");
    assert(typeof scores.traffic === "number", "traffic olmali");
    assert(typeof scores.difficulty === "number", "difficulty olmali");
    assert(scores.traffic >= 0, "traffic >= 0 olmali");
    assert(scores.difficulty >= 0, "difficulty >= 0 olmali");
    console.log(`    ${INFO} Traffic: ${scores.traffic}, Difficulty: ${scores.difficulty}`);
  });

  await test("getScores — 'muzik' TR", async () => {
    const scores = await getScores("muzik", "tr");
    assert(typeof scores.traffic === "number", "traffic olmali");
    console.log(`    ${INFO} Traffic: ${scores.traffic}, Difficulty: ${scores.difficulty}`);
  });

  await test("getScores — 'photo editor' US", async () => {
    const scores = await getScores("photo editor", "us");
    assert(scores.traffic > 0, "traffic > 0 bekleniyor");
    console.log(`    ${INFO} Traffic: ${scores.traffic}, Difficulty: ${scores.difficulty}`);
  });

  await test("suggestKeywords — Spotify (competition)", async () => {
    const keywords = await suggestKeywords("324684580", "competition", "tr", 10);
    assert(Array.isArray(keywords), "Array donmeli");
    console.log(`    ${INFO} ${keywords.length} keyword onerildi: ${keywords.slice(0, 5).join(", ")}`);
  });

  // ─── 5. Entegrasyon: Tool Senaryolari ───
  console.log("\n🔗 Entegrasyon Senaryolari");

  await test("Senaryo: Keyword arastirmasi (search + score)", async () => {
    const keyword = "meditation";
    const apps = await searchApps(keyword, "us", 5);
    const scores = await getScores(keyword, "us");
    assert(apps.length > 0, "App sonuclari olmali");
    assert(typeof scores.traffic === "number", "Skorlar olmali");
    const competitive = calculateCompetitiveScore(
      apps.map((a: any) => ({
        rating: a.score || 0,
        reviews: a.reviews || 0,
        free: a.free ?? true,
      }))
    );
    console.log(`    ${INFO} "${keyword}": ${apps.length} app, traffic=${scores.traffic}, difficulty=${scores.difficulty}, competitive=${competitive.toFixed(1)}`);
  });

  await test("Senaryo: App detay + review analizi", async () => {
    const app = await getAppDetails("com.spotify.client", "us");
    const reviews = await getReviews(app.id, "us", 1);
    assert(app.title != null, "App bilgisi olmali");
    assert(reviews.length > 0, "Review olmali");

    // Basit sentiment
    let pos = 0, neg = 0;
    for (const r of reviews) {
      if (r.score >= 4) pos++;
      else if (r.score <= 2) neg++;
    }
    console.log(`    ${INFO} ${app.title}: ${reviews.length} review, ${pos} pozitif, ${neg} negatif`);
  });

  await test("Senaryo: Keyword gap (iki app karsilastirma)", async () => {
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
    console.log(`    ${INFO} Ortak: [${shared.join(", ")}] | Sadece 1: [${onlyApp1.join(", ")}] | Sadece 2: [${onlyApp2.join(", ")}]`);
  });

  // ─── Sonuc ───
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${PASS} ${passed} test basarili`);
  if (failed > 0) console.log(`  ${FAIL} ${failed} test basarisiz`);
  else console.log(`  🎉 Tum testler gecti!`);
  console.log(`${"─".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

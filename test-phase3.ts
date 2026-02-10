/**
 * Faz 3 tool'larinin entegrasyon testi
 * Calistir: npx tsx test-phase3.ts
 */

import { getAppDetails, searchApps, getReviews, getSimilarApps } from "./src/data-sources/app-store.js";
import { getScores } from "./src/data-sources/aso-scoring.js";
import { initCache } from "./src/cache/sqlite-cache.js";
import { extractTitleKeywords, calculateVisibilityScore, calculateCompetitiveScore, calculateOpportunityScore, calculateOverallScore } from "./src/data-sources/custom-scoring.js";
import { getCountryName } from "./src/utils/localization.js";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";

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
  console.log("\n🔧 Faz 3 — Entegrasyon Testleri\n");
  initCache();

  // ─── localized_keywords senaryosu ───
  console.log("🌍 localized_keywords");

  await test("Keyword skorlari farkli ulkelerde", async () => {
    const keyword = "fitness";
    const countries = ["tr", "us", "de"];
    const results: { country: string; traffic: number; difficulty: number }[] = [];

    for (const c of countries) {
      const scores = await getScores(keyword, c);
      results.push({ country: c, ...scores });
    }

    for (const r of results) {
      assert(typeof r.traffic === "number", `${r.country} traffic olmali`);
      console.log(`    ${INFO} ${getCountryName(r.country)}: traffic=${r.traffic}, difficulty=${r.difficulty}`);
    }
  });

  await test("Her ulkede farkli top app", async () => {
    const keyword = "weather";
    const countries = ["tr", "us"];
    for (const c of countries) {
      const apps = await searchApps(keyword, c, 1);
      const topApp = (apps[0] as any)?.title || "Yok";
      console.log(`    ${INFO} ${getCountryName(c)}: #1 = "${topApp}"`);
    }
  });

  // ─── get_aso_report senaryosu ───
  console.log("\n📋 get_aso_report");

  await test("Spotify icin kapsamli ASO raporu", async () => {
    const app = await getAppDetails("com.spotify.client", "tr");
    assert(app.title != null, "App bilgisi olmali");

    // Title keywords
    const titleKeywords = extractTitleKeywords(app.title || "");
    console.log(`    ${INFO} Title: "${app.title}"`);
    console.log(`    ${INFO} Title keywords: [${titleKeywords.join(", ")}]`);

    // Keyword skorlari
    for (const kw of titleKeywords.slice(0, 3)) {
      const scores = await getScores(kw, "tr");
      console.log(`    ${INFO} "${kw}": traffic=${scores.traffic}, difficulty=${scores.difficulty}`);
    }

    // Rakipler
    const competitors = await searchApps(app.title.split(/[-:|]/)[0].trim(), "tr", 3);
    const compData = competitors
      .filter((a: any) => a.id !== app.id)
      .slice(0, 2)
      .map((a: any) => ({
        title: a.title,
        rating: a.score || 0,
        reviews: a.reviews || 0,
        free: a.free ?? true,
      }));
    console.log(`    ${INFO} Rakipler: ${compData.map((c: any) => c.title).join(", ")}`);

    // Scoring
    const visibility = calculateVisibilityScore({
      rating: app.score || 0,
      reviewCount: app.reviews || 0,
    });
    const competitive = calculateCompetitiveScore(compData);
    const opportunity = calculateOpportunityScore(5, competitive);
    const overall = calculateOverallScore({
      visibilityScore: visibility,
      competitiveScore: competitive,
      opportunityScore: opportunity,
    });

    console.log(`    ${INFO} Skorlar: overall=${overall.toFixed(1)}, visibility=${visibility.toFixed(1)}, competitive=${competitive.toFixed(1)}, opportunity=${opportunity.toFixed(1)}`);

    // Reviews
    const reviews = await getReviews(app.id, "tr", 1);
    let pos = 0, neg = 0;
    for (const r of reviews) {
      if (r.score >= 4) pos++;
      else if (r.score <= 2) neg++;
    }
    console.log(`    ${INFO} Reviews: ${reviews.length} toplam, ${pos} pozitif, ${neg} negatif`);

    // Metadata
    const titleLen = (app.title || "").length;
    console.log(`    ${INFO} Title: ${titleLen}/30 karakter (${30 - titleLen} kaldi)`);
  });

  await test("Kucuk bir app icin rapor", async () => {
    // Shazam
    const app = await getAppDetails("284993459", "tr");
    assert(app.title != null, "App bilgisi olmali");

    const titleKeywords = extractTitleKeywords(app.title || "");
    const visibility = calculateVisibilityScore({
      rating: app.score || 0,
      reviewCount: app.reviews || 0,
    });

    console.log(`    ${INFO} ${app.title} — Rating: ${app.score}, Reviews: ${app.reviews}`);
    console.log(`    ${INFO} Keywords: [${titleKeywords.join(", ")}]`);
    console.log(`    ${INFO} Visibility: ${visibility.toFixed(1)}`);
  });

  // ─── Sonuc ───
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${PASS} ${passed} test basarili`);
  if (failed > 0) console.log(`  ${FAIL} ${failed} test basarisiz`);
  else console.log(`  🎉 Faz 3 testleri gecti!`);
  console.log(`${"─".repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

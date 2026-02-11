/**
 * ASO Generation Tools — Real Scenario Test
 * Scenario: ASO process from scratch for a new fitness app
 *
 * Run: npx tsx test-generation.ts
 */

import { searchApps, getAppDetails, getSuggestions } from "./src/data-sources/app-store.js";
import { getScores } from "./src/data-sources/aso-scoring.js";
import { initCache } from "./src/cache/sqlite-cache.js";
import { extractTitleKeywords, calculateOpportunityScore, calculateCompetitiveScore } from "./src/data-sources/custom-scoring.js";
import { getCountryName } from "./src/utils/localization.js";
import { CHAR_LIMITS } from "./src/utils/constants.js";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

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
  console.log(`\n${BOLD}🚀 ASO Generation — Real Scenario Test${RESET}`);
  console.log(`   Scenario: "FitTrack" calorie tracking app\n`);
  initCache();

  // ─── SCENARIO: New fitness app ───
  const APP = {
    name: "FitTrack",
    category: "Health & Fitness",
    niche: "calorie tracking and diet planning",
    features: ["calorie counter", "barcode scanner", "water tracking", "diet plan", "weight tracking"],
    targetAudience: "women on a diet aged 25-40",
    countries: ["tr", "us"],
  };

  // ─── 1. discover_keywords scenario ───
  console.log(`${BOLD}📍 Step 1: Keyword Discovery${RESET}`);

  await test("Build search terms from features", async () => {
    const terms = [...APP.features.slice(0, 6), APP.category];
    assert(terms.length >= 5, "Should have at least 5 terms");
    console.log(`    ${INFO} Search terms: ${terms.join(", ")}`);
  });

  await test("Scan top apps for each term", async () => {
    const allApps = new Map<string, any>();
    for (const term of APP.features.slice(0, 3)) {
      const apps = await searchApps(term, "tr", 5);
      for (const a of apps) {
        allApps.set((a as any).appId || String((a as any).id), a);
      }
    }
    assert(allApps.size > 0, "Should find apps");
    console.log(`    ${INFO} ${allApps.size} unique apps scanned`);

    const topApps = [...allApps.values()]
      .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
      .slice(0, 3);
    for (const a of topApps) {
      console.log(`    ${INFO} ${a.title} — ${a.reviews} reviews`);
    }
  });

  await test("Extract keyword pool from titles", async () => {
    const apps = await searchApps("kalori", "tr", 10);
    const allKeywords = new Set<string>();
    for (const app of apps) {
      const kws = extractTitleKeywords((app as any).title || "");
      kws.forEach((k: string) => allKeywords.add(k));
    }
    assert(allKeywords.size > 0, "Keywords should be extracted");
    console.log(`    ${INFO} ${allKeywords.size} unique keywords: ${[...allKeywords].slice(0, 10).join(", ")}`);
  });

  await test("Get autocomplete suggestions", async () => {
    const suggestions = await getSuggestions("kalori");
    assert(Array.isArray(suggestions), "Suggestions should be an array");
    console.log(`    ${INFO} ${suggestions.length} autocomplete suggestions`);
  });

  await test("Score keywords and rank opportunities", async () => {
    const testKeywords = ["kalori", "diyet", "kilo", "fitness", "saglik"];
    const scored: { kw: string; traffic: number; difficulty: number; opp: number }[] = [];

    for (const kw of testKeywords) {
      const scores = await getScores(kw, "tr");
      const opp = calculateOpportunityScore(scores.traffic, scores.difficulty);
      scored.push({ kw, traffic: scores.traffic, difficulty: scores.difficulty, opp });
    }

    scored.sort((a, b) => b.opp - a.opp);
    for (const s of scored) {
      const tier = s.opp >= 7 ? "A" : s.opp >= 5 ? "B" : s.opp >= 3 ? "C" : "D";
      console.log(`    ${INFO} [${tier}] "${s.kw}": traffic=${s.traffic}, diff=${s.difficulty}, opp=${s.opp.toFixed(1)}`);
    }
  });

  // ─── 2. generate_aso_brief scenario ───
  console.log(`\n${BOLD}📍 Step 2: ASO Brief Generation${RESET}`);

  await test("Competitor analysis", async () => {
    const apps = await searchApps("kalori sayaci", "tr", 5);
    const competitors = apps.map((a: any) => ({
      title: a.title,
      rating: a.score || 0,
      reviews: a.reviews || 0,
      titleLength: (a.title || "").length,
      titleKeywords: extractTitleKeywords(a.title || ""),
    }));

    const compScore = calculateCompetitiveScore(
      competitors.map((c) => ({ rating: c.rating, reviews: c.reviews, free: true }))
    );

    console.log(`    ${INFO} Competition score: ${compScore.toFixed(1)} (${compScore > 7 ? "High" : compScore > 4 ? "Medium" : "Low"})`);
    for (const c of competitors.slice(0, 3)) {
      console.log(`    ${INFO} "${c.title}" (${c.titleLength} chars) — Keywords: [${c.titleKeywords.join(", ")}]`);
    }

    // Common keywords
    const kwFreq: Record<string, number> = {};
    for (const c of competitors) {
      for (const kw of c.titleKeywords) {
        kwFreq[kw] = (kwFreq[kw] || 0) + 1;
      }
    }
    const common = Object.entries(kwFreq)
      .filter(([, n]) => n >= 2)
      .map(([kw]) => kw);
    console.log(`    ${INFO} Common among competitors: [${common.join(", ")}]`);
  });

  await test("Title/Subtitle/Keyword field suggestions", async () => {
    const topKws = ["kalori", "diyet", "kilo", "fitness", "saglik", "beslenme", "egzersiz"];
    const scored = [];
    for (const kw of topKws) {
      const s = await getScores(kw, "tr");
      scored.push({ keyword: kw, traffic: s.traffic });
    }
    scored.sort((a, b) => b.traffic - a.traffic);

    // Title suggestion
    const titleKws = scored.slice(0, 2).map((k) => k.keyword);
    const title = `${APP.name} - ${titleKws.join(" ")}`.slice(0, CHAR_LIMITS.TITLE);
    console.log(`    ${INFO} Title suggestion: "${title}" (${title.length}/${CHAR_LIMITS.TITLE})`);

    // Subtitle suggestion
    const subtitleKws = scored.slice(2, 5).map((k) => k.keyword);
    const subtitle = subtitleKws.join(", ").slice(0, CHAR_LIMITS.SUBTITLE);
    console.log(`    ${INFO} Subtitle suggestion: "${subtitle}" (${subtitle.length}/${CHAR_LIMITS.SUBTITLE})`);

    // Keyword field
    const usedKws = new Set([...titleKws, ...subtitleKws]);
    const fieldKws = scored.filter((k) => !usedKws.has(k.keyword)).map((k) => k.keyword);
    const field = [...fieldKws, ...APP.features.map((f) => f.replace(/\s+/g, ""))].join(",").slice(0, CHAR_LIMITS.KEYWORD_FIELD);
    console.log(`    ${INFO} Keyword field: "${field}" (${field.length}/${CHAR_LIMITS.KEYWORD_FIELD})`);

    assert(title.length <= CHAR_LIMITS.TITLE, "Title should not exceed limit");
    assert(subtitle.length <= CHAR_LIMITS.SUBTITLE, "Subtitle should not exceed limit");
    assert(field.length <= CHAR_LIMITS.KEYWORD_FIELD, "Keyword field should not exceed limit");
  });

  await test("Multi-market comparison", async () => {
    const keyword = "calorie counter";
    for (const c of APP.countries) {
      const scores = await getScores(keyword, c);
      const apps = await searchApps(keyword, c, 1);
      const topApp = (apps[0] as any)?.title || "—";
      console.log(`    ${INFO} ${getCountryName(c)}: traffic=${scores.traffic}, #1="${topApp}"`);
    }
  });

  // ─── Result ───
  console.log(`\n${"─".repeat(55)}`);
  console.log(`  ${PASS} ${passed} tests passed`);
  if (failed > 0) console.log(`  ${FAIL} ${failed} tests failed`);
  else console.log(`  🎉 ASO Generation tests passed!`);
  console.log(`${"─".repeat(55)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

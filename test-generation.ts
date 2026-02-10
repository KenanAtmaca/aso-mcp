/**
 * ASO Generation Tools — Gercek Senaryo Testi
 * Yeni bir fitness uygulamasi icin sifirdan ASO sureci
 *
 * Calistir: npx tsx test-generation.ts
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
  console.log(`\n${BOLD}🚀 ASO Generation — Gercek Senaryo Testi${RESET}`);
  console.log(`   Senaryo: "FitTrack" kalori takip uygulamasi\n`);
  initCache();

  // ─── SENARYO: Yeni fitness uygulamasi ───
  const APP = {
    name: "FitTrack",
    category: "Health & Fitness",
    niche: "kalori takibi ve diyet planlama",
    features: ["kalori sayaci", "barkod okuyucu", "su takibi", "diyet plani", "kilo takibi"],
    targetAudience: "diyet yapan kadinlar 25-40 yas",
    countries: ["tr", "us"],
  };

  // ─── 1. discover_keywords senaryosu ───
  console.log(`${BOLD}📍 Adim 1: Keyword Kesfi${RESET}`);

  await test("Ozelliklerden arama terimleri olustur", async () => {
    const terms = [...APP.features.slice(0, 6), APP.category];
    assert(terms.length >= 5, "En az 5 terim olmali");
    console.log(`    ${INFO} Arama terimleri: ${terms.join(", ")}`);
  });

  await test("Her terimle top app'leri tara", async () => {
    const allApps = new Map<string, any>();
    for (const term of APP.features.slice(0, 3)) {
      const apps = await searchApps(term, "tr", 5);
      for (const a of apps) {
        allApps.set((a as any).appId || String((a as any).id), a);
      }
    }
    assert(allApps.size > 0, "App bulunmali");
    console.log(`    ${INFO} ${allApps.size} benzersiz app taralanidi`);

    const topApps = [...allApps.values()]
      .sort((a, b) => (b.reviews || 0) - (a.reviews || 0))
      .slice(0, 3);
    for (const a of topApps) {
      console.log(`    ${INFO} ${a.title} — ${a.reviews} yorum`);
    }
  });

  await test("Title'lardan keyword havuzu cikar", async () => {
    const apps = await searchApps("kalori", "tr", 10);
    const allKeywords = new Set<string>();
    for (const app of apps) {
      const kws = extractTitleKeywords((app as any).title || "");
      kws.forEach((k: string) => allKeywords.add(k));
    }
    assert(allKeywords.size > 0, "Keyword cikarilmali");
    console.log(`    ${INFO} ${allKeywords.size} benzersiz keyword: ${[...allKeywords].slice(0, 10).join(", ")}`);
  });

  await test("Autocomplete onerileri al", async () => {
    const suggestions = await getSuggestions("kalori");
    assert(Array.isArray(suggestions), "Oneriler array olmali");
    console.log(`    ${INFO} ${suggestions.length} autocomplete onerisi`);
  });

  await test("Keyword'leri skorla ve firsatlari sirala", async () => {
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

  // ─── 2. generate_aso_brief senaryosu ───
  console.log(`\n${BOLD}📍 Adim 2: ASO Brief Olusturma${RESET}`);

  await test("Rakip analizi", async () => {
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

    console.log(`    ${INFO} Rekabet skoru: ${compScore.toFixed(1)} (${compScore > 7 ? "Yuksek" : compScore > 4 ? "Orta" : "Dusuk"})`);
    for (const c of competitors.slice(0, 3)) {
      console.log(`    ${INFO} "${c.title}" (${c.titleLength} kar) — Keywords: [${c.titleKeywords.join(", ")}]`);
    }

    // Ortak keyword'ler
    const kwFreq: Record<string, number> = {};
    for (const c of competitors) {
      for (const kw of c.titleKeywords) {
        kwFreq[kw] = (kwFreq[kw] || 0) + 1;
      }
    }
    const common = Object.entries(kwFreq)
      .filter(([, n]) => n >= 2)
      .map(([kw]) => kw);
    console.log(`    ${INFO} Rakiplerde ortak: [${common.join(", ")}]`);
  });

  await test("Title/Subtitle/Keyword field onerileri", async () => {
    const topKws = ["kalori", "diyet", "kilo", "fitness", "saglik", "beslenme", "egzersiz"];
    const scored = [];
    for (const kw of topKws) {
      const s = await getScores(kw, "tr");
      scored.push({ keyword: kw, traffic: s.traffic });
    }
    scored.sort((a, b) => b.traffic - a.traffic);

    // Title onerisi
    const titleKws = scored.slice(0, 2).map((k) => k.keyword);
    const title = `${APP.name} - ${titleKws.join(" ")}`.slice(0, CHAR_LIMITS.TITLE);
    console.log(`    ${INFO} Title onerisi: "${title}" (${title.length}/${CHAR_LIMITS.TITLE})`);

    // Subtitle onerisi
    const subtitleKws = scored.slice(2, 5).map((k) => k.keyword);
    const subtitle = subtitleKws.join(", ").slice(0, CHAR_LIMITS.SUBTITLE);
    console.log(`    ${INFO} Subtitle onerisi: "${subtitle}" (${subtitle.length}/${CHAR_LIMITS.SUBTITLE})`);

    // Keyword field
    const usedKws = new Set([...titleKws, ...subtitleKws]);
    const fieldKws = scored.filter((k) => !usedKws.has(k.keyword)).map((k) => k.keyword);
    const field = [...fieldKws, ...APP.features.map((f) => f.replace(/\s+/g, ""))].join(",").slice(0, CHAR_LIMITS.KEYWORD_FIELD);
    console.log(`    ${INFO} Keyword field: "${field}" (${field.length}/${CHAR_LIMITS.KEYWORD_FIELD})`);

    assert(title.length <= CHAR_LIMITS.TITLE, "Title limit asilmamali");
    assert(subtitle.length <= CHAR_LIMITS.SUBTITLE, "Subtitle limit asilmamali");
    assert(field.length <= CHAR_LIMITS.KEYWORD_FIELD, "Keyword field limit asilmamali");
  });

  await test("Coklu pazar karsilastirmasi", async () => {
    const keyword = "calorie counter";
    for (const c of APP.countries) {
      const scores = await getScores(keyword, c);
      const apps = await searchApps(keyword, c, 1);
      const topApp = (apps[0] as any)?.title || "—";
      console.log(`    ${INFO} ${getCountryName(c)}: traffic=${scores.traffic}, #1="${topApp}"`);
    }
  });

  // ─── Sonuc ───
  console.log(`\n${"─".repeat(55)}`);
  console.log(`  ${PASS} ${passed} test basarili`);
  if (failed > 0) console.log(`  ${FAIL} ${failed} test basarisiz`);
  else console.log(`  🎉 ASO Generation testleri gecti!`);
  console.log(`${"─".repeat(55)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

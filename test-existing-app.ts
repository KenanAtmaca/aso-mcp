/**
 * Existing App ASO Generation — Live Test
 * Scenario: ASO improvement for the Shazam app
 */
import { getAppDetails, searchApps } from "./src/data-sources/app-store.js";
import { getScores } from "./src/data-sources/aso-scoring.js";
import { initCache } from "./src/cache/sqlite-cache.js";
import { extractTitleKeywords } from "./src/data-sources/custom-scoring.js";
import { CHAR_LIMITS } from "./src/utils/constants.js";

initCache();

const app = await getAppDetails("284993459", "tr");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  EXISTING APP ASO ANALYSIS: " + app.title);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log("Rating:", app.score, "| Reviews:", app.reviews);
console.log("Title length:", (app.title || "").length, "/", CHAR_LIMITS.TITLE);
console.log("");

// Keyword analysis
const titleKws = extractTitleKeywords(app.title || "");
console.log("Current title keywords:", titleKws);
console.log("");

for (const kw of titleKws.slice(0, 4)) {
  const s = await getScores(kw, "tr");
  console.log("  \"" + kw + "\": traffic=" + s.traffic + ", difficulty=" + s.difficulty);
}

// Missing keywords from competitors
const competitors = await searchApps(titleKws[0] || "music", "tr", 5);
const compKws = new Set<string>();
for (const c of competitors) {
  const kws = extractTitleKeywords((c as any).title || "");
  for (const k of kws) compKws.add(k);
}
const titleKwSet = new Set(titleKws);
const missing = [...compKws].filter((k) => !titleKwSet.has(k));

console.log("");
console.log("Competitors:");
for (const c of competitors.slice(0, 3)) {
  const a = c as any;
  console.log("  - " + a.title + " (" + (a.reviews || 0) + " reviews)");
}
console.log("");
console.log("In competitors but not in yours:", missing.slice(0, 8));
console.log("");

// Suggestions
const allKws = [...titleKws, ...missing];
const scored: { kw: string; traffic: number }[] = [];
for (const kw of allKws.slice(0, 10)) {
  const s = await getScores(kw, "tr");
  scored.push({ kw, traffic: s.traffic });
}
scored.sort((a, b) => b.traffic - a.traffic);

const appBaseName = (app.title || "").split(/[-:|&]/)[0].trim();
const titleSugg = (appBaseName + " - " + scored.slice(0, 2).map((k) => k.kw).join(" ")).slice(
  0,
  CHAR_LIMITS.TITLE
);
const subtitleSugg = scored
  .slice(2, 5)
  .map((k) => k.kw)
  .join(", ")
  .slice(0, CHAR_LIMITS.SUBTITLE);
const fieldKws = scored
  .slice(5)
  .map((k) => k.kw)
  .join(",")
  .slice(0, CHAR_LIMITS.KEYWORD_FIELD);

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  ASO SUGGESTIONS");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("");
console.log("Title:    \"" + titleSugg + "\" (" + titleSugg.length + "/" + CHAR_LIMITS.TITLE + ")");
console.log("Subtitle: \"" + subtitleSugg + "\" (" + subtitleSugg.length + "/" + CHAR_LIMITS.SUBTITLE + ")");
console.log("Keywords: \"" + fieldKws + "\" (" + fieldKws.length + "/" + CHAR_LIMITS.KEYWORD_FIELD + ")");
console.log("");
console.log("✅ Existing app ASO generation successful!");

export const OPPORTUNITY_TIERS = {
  HIGH: 7,
  MEDIUM: 5,
  LOW: 3,
} as const;

export type OpportunityTier = "A" | "B" | "C" | "D";

export function classifyOpportunity(score: number): {
  tier: OpportunityTier;
  label: string;
} {
  if (score >= OPPORTUNITY_TIERS.HIGH) return { tier: "A", label: "A: High opportunity" };
  if (score >= OPPORTUNITY_TIERS.MEDIUM) return { tier: "B", label: "B: Medium opportunity" };
  if (score >= OPPORTUNITY_TIERS.LOW) return { tier: "C", label: "C: Low opportunity" };
  return { tier: "D", label: "D: Weak" };
}

export function isHighOpportunity(score: number): boolean {
  return score >= OPPORTUNITY_TIERS.HIGH;
}

export function isMediumOrHigherOpportunity(score: number): boolean {
  return score >= OPPORTUNITY_TIERS.MEDIUM;
}

export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function formatCompetitionLevel(difficulty: number): string {
  if (difficulty > 7) return "High";
  if (difficulty > 4) return "Medium";
  return "Low";
}

export function formatTrafficLevel(traffic: number): string {
  if (traffic > 7) return "High";
  if (traffic > 4) return "Medium";
  return "Low";
}

export function generateRecommendation(scores: {
  traffic: number;
  difficulty: number;
}): string {
  if (scores.traffic > 6 && scores.difficulty < 5) {
    return "Excellent opportunity! High traffic, low competition.";
  } else if (scores.traffic > 6 && scores.difficulty > 6) {
    return "High traffic but competition is also high. Try long-tail variations.";
  } else if (scores.traffic < 4 && scores.difficulty < 4) {
    return "Low traffic, low competition. Niche keyword. Support with additional keywords.";
  } else {
    return "Low traffic, high competition. Consider alternative keywords.";
  }
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// ─── Score source transparency ───
// The aso package falls back to multi-signal estimates when Apple returns 503.
// Tools surface where their numbers came from so AI clients can weigh them,
// and cache estimated results for a shorter time (the fallback retries the
// real API after 10 minutes, so stale estimates should not outlive it by much).

export type ScoresSourceSummary = "apple" | "estimated" | "mixed";

const ESTIMATED_TTL_CAP = 600; // seconds

export function summarizeScoresSource(
  items: { source?: string }[]
): ScoresSourceSummary {
  const hasApple = items.some((i) => i.source === "apple");
  const hasEstimated = items.some((i) => i.source === "estimated");
  if (hasApple && hasEstimated) return "mixed";
  if (hasEstimated) return "estimated";
  return "apple";
}

export function scoresCacheTtl(
  baseTtl: number,
  source: ScoresSourceSummary
): number {
  return source === "apple" ? baseTtl : Math.min(baseTtl, ESTIMATED_TTL_CAP);
}

export function scoresSourceNote(source: ScoresSourceSummary): string | undefined {
  if (source === "apple") return undefined;
  return "Some or all scores are estimated from App Store search-result signals because the Apple scores API was unavailable. Treat them as approximations.";
}

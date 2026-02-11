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
    return "Low traffic, low competition. Niche keyword — support with additional keywords.";
  } else {
    return "Low traffic, high competition. Consider alternative keywords.";
  }
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

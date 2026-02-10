export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function formatCompetitionLevel(difficulty: number): string {
  if (difficulty > 7) return "Yuksek";
  if (difficulty > 4) return "Orta";
  return "Dusuk";
}

export function formatTrafficLevel(traffic: number): string {
  if (traffic > 7) return "Yuksek";
  if (traffic > 4) return "Orta";
  return "Dusuk";
}

export function generateRecommendation(scores: {
  traffic: number;
  difficulty: number;
}): string {
  if (scores.traffic > 6 && scores.difficulty < 5) {
    return "Mukemmel firsat! Yuksek traffic, dusuk rekabet.";
  } else if (scores.traffic > 6 && scores.difficulty > 6) {
    return "Yuksek traffic ama rekabet de yuksek. Long-tail varyasyonlari dene.";
  } else if (scores.traffic < 4 && scores.difficulty < 4) {
    return "Dusuk traffic, dusuk rekabet. Nis keyword — ek keyword'lerle destekle.";
  } else {
    return "Traffic dusuk, rekabet yuksek. Alternatif keyword'lere yonel.";
  }
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// Scoring. A run's score is the weighted fraction of its scored graders. Graders marked withOnly
// (they can only pass with the skill loaded, e.g. "the skill fired") are left out of the score in
// BOTH arms so the with/without delta stays fair, unless every grader is withOnly.

export function scoreRun(grades) {
  const allWithOnly = grades.length > 0 && grades.every(g => g.withOnly);
  let total = 0, got = 0;
  for (const g of grades) {
    g.scored = allWithOnly || !g.withOnly;
    if (!g.scored) continue;
    total += g.weight ?? 1;
    if (g.passed) got += g.weight ?? 1;
  }
  return total ? got / total : 0;
}

// passAll: every run scored 1.0 (pass^k), what a safety case must reach.
export function scoreCase(scores) {
  if (!scores.length) return { mean: null, passAll: false, runs: 0 };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { mean, passAll: scores.every(s => s === 1), runs: scores.length };
}

// USD for one run from its token counts; prices are USD per 1M tokens.
export function runCost(t, price) {
  return (t.input * price.in + t.cacheCreation * (price.cacheWrite ?? price.in) + t.cacheRead * (price.cacheRead ?? price.in) + t.output * price.out) / 1e6;
}

/**
 * Local positional grading used for the dashboard header tiles.
 *
 * We grade each position group on three axes:
 *   1. Startable depth — how many "good enough" starters does the user have?
 *   2. Age curve       — younger dynasty assets weigh more.
 *   3. Concentration   — too many bodies at one position = redundancy.
 *
 * This is a heuristic — Claude produces the real opinionated grade in the
 * AI analysis. But we want *something* visible before the AI call completes.
 */

const POS = ['QB', 'RB', 'WR', 'TE'];

const AGE_SWEET_SPOT = {
  QB: [25, 32],
  RB: [22, 26],
  WR: [23, 28],
  TE: [24, 29]
};

function letterFromScore(score) {
  if (score >= 92) return 'A+';
  if (score >= 88) return 'A';
  if (score >= 84) return 'A-';
  if (score >= 80) return 'B+';
  if (score >= 76) return 'B';
  if (score >= 72) return 'B-';
  if (score >= 68) return 'C+';
  if (score >= 64) return 'C';
  if (score >= 60) return 'C-';
  if (score >= 55) return 'D+';
  if (score >= 50) return 'D';
  return 'F';
}

function ageFactor(age, pos) {
  if (!age) return 0.5;
  const [lo, hi] = AGE_SWEET_SPOT[pos] || [24, 28];
  if (age <= lo - 2) return 0.85; // very young upside
  if (age <= lo) return 1;
  if (age <= hi) return 0.95;
  if (age <= hi + 2) return 0.7;
  if (age <= hi + 4) return 0.45;
  return 0.2;
}

export function gradePosition(pos, players) {
  const group = players.filter((p) => p.position === pos);
  if (group.length === 0) {
    return { grade: 'F', score: 0, count: 0, avgAge: null };
  }
  const ages = group.map((p) => p.age).filter(Boolean);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;

  // Depth score caps at 4 (for RB/WR), 2 (QB/TE) — adjust by format
  const depthTarget = pos === 'WR' ? 5 : pos === 'RB' ? 4 : pos === 'QB' ? 2 : 2;
  const depthScore = Math.min(group.length, depthTarget) / depthTarget; // 0-1

  const ageScores = group.slice(0, depthTarget).map((p) => ageFactor(p.age, pos));
  const ageScore = ageScores.reduce((a, b) => a + b, 0) / Math.max(ageScores.length, 1);

  const concentrationPenalty =
    group.length > depthTarget + 3 ? 0.9 : group.length > depthTarget + 1 ? 0.97 : 1;

  const raw = (depthScore * 0.55 + ageScore * 0.45) * concentrationPenalty * 100;
  const score = Math.round(raw);
  return { grade: letterFromScore(score), score, count: group.length, avgAge };
}

export function gradeRoster(roster) {
  const all = [...(roster.starters || []), ...(roster.bench || []), ...(roster.taxi || [])];
  const result = {};
  for (const pos of POS) result[pos] = gradePosition(pos, all);

  const weights = { QB: 0.2, RB: 0.3, WR: 0.35, TE: 0.15 };
  const overallScore = Math.round(
    POS.reduce((acc, p) => acc + (result[p].score || 0) * weights[p], 0)
  );
  return { positions: result, overall: { grade: letterFromScore(overallScore), score: overallScore } };
}

export function gradeTone(grade) {
  if (!grade) return 'text-ink-300';
  const letter = grade[0];
  return {
    A: 'text-emerald-400',
    B: 'text-sky-400',
    C: 'text-amber-400',
    D: 'text-orange-400',
    F: 'text-red-400'
  }[letter] || 'text-ink-300';
}

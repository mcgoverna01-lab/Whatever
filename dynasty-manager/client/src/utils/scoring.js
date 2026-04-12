/**
 * Small helpers for interpreting league settings.
 * Kept client-side so we can render league metadata badges without re-hitting the server.
 */

export function describeScoring(league) {
  if (!league) return '';
  const tags = [league.ppr];
  if (league.is_superflex) tags.push('Superflex');
  else tags.push('1QB');
  if (league.te_premium) tags.push('TEP');
  tags.push(`${league.total_rosters}-team`);
  return tags.join(' \u00b7 ');
}

export function countPositions(roster) {
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, OTHER: 0 };
  const all = [...(roster.starters || []), ...(roster.bench || []), ...(roster.taxi || [])];
  for (const p of all) {
    if (counts[p.position] !== undefined) counts[p.position] += 1;
    else counts.OTHER += 1;
  }
  return counts;
}

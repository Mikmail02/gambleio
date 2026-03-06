/**
 * Case Battle – core math and game-mode logic.
 * Admin: EV = Σ(P_i * V_i), Price = EV / RTP. Probabilities must sum to 100%.
 * Battles: resolve winner by mode (Standard, Terminal, Co-op, Crazy, Jackpot).
 */

const PROB_TOLERANCE = 0.0001;

/**
 * Validates that item probabilities sum to 100% (1.0).
 * @param {Array<{ value: number, probability: number }>} items
 * @returns {{ valid: boolean, sum: number, error?: string }}
 */
function validateProbabilities(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, sum: 0, error: 'Items must be a non-empty array' };
  }
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    const p = Number(items[i].probability);
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      return { valid: false, sum, error: `Item ${i}: probability must be between 0 and 1` };
    }
    sum += p;
  }
  if (Math.abs(sum - 1) > PROB_TOLERANCE) {
    return { valid: false, sum, error: `Probabilities sum to ${(sum * 100).toFixed(4)}%; must equal 100%` };
  }
  return { valid: true, sum: 1 };
}

/**
 * Expected value of a case: EV = Σ(P_i * V_i).
 * @param {Array<{ value: number, probability: number }>} items
 * @returns {number}
 */
function expectedValue(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  let ev = 0;
  for (const item of items) {
    const v = Number(item.value);
    const p = Number(item.probability);
    if (Number.isFinite(v) && Number.isFinite(p)) ev += p * v;
  }
  return ev;
}

/**
 * Case price from EV and RTP: Price = EV / RTP.
 * RTP as decimal (e.g. 0.95 for 95%). Validates probabilities first.
 * @param {Array<{ value: number, probability: number }>} items
 * @param {number} rtpDecimal - e.g. 0.95 for 95% RTP
 * @returns {{ success: boolean, price?: number, ev?: number, error?: string }}
 */
function calculateCasePrice(items, rtpDecimal) {
  const rtp = Number(rtpDecimal);
  if (!Number.isFinite(rtp) || rtp <= 0 || rtp > 1) {
    return { success: false, error: 'RTP must be a decimal between 0 and 1 (e.g. 0.95 for 95%)' };
  }
  const validation = validateProbabilities(items);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  const ev = expectedValue(items);
  const price = ev / rtp;
  return { success: true, price, ev };
}

// --- Battle formats: allowed player/team counts ---
const BATTLE_FORMATS = [
  [1, 1],
  [1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1],
  [2, 2],
  [2, 2, 2],
  [3, 3],
];

function isAllowedFormat(slotsPerSide) {
  const key = slotsPerSide.slice().sort((a, b) => a - b).join(',');
  return BATTLE_FORMATS.some((f) => f.slice().sort((a, b) => a - b).join(',') === key);
}

/**
 * Resolve battle winner and payouts by game mode.
 * ALL modes use totalValueOfAllItems (sum of all opened items) for payout – never entry cost.
 *
 * @param {Array<{ teamIndex: number, slotIndex: number, totalValue: number, terminalValue: number }>} participants
 * @param {string} mode - 'standard' | 'terminal' | 'coop' | 'jackpot'
 * @param {{ totalValueOfAllItems: number, crazyMode?: boolean }} opts - MUST be sum of all participants' item values (totalValue)
 * @returns {{ winnerTeamIndex: number | null, payouts: Array<{ teamIndex, slotIndex, amount }>, isTie?: boolean }}
 */
function resolveBattleResult(participants, mode, opts = {}) {
  const totalValueOfAllItems = Number(opts.totalValueOfAllItems) || 0;
  const payouts = participants.map((p) => ({ teamIndex: p.teamIndex, slotIndex: p.slotIndex, amount: 0 }));

  if (mode === 'coop') {
    const perPlayer = participants.length > 0 ? totalValueOfAllItems / participants.length : 0;
    payouts.forEach((p) => { p.amount = perPlayer; });
    return { winnerTeamIndex: null, payouts, isTie: false };
  }

  const useTerminal = mode === 'terminal';
  const useCrazy = !!opts.crazyMode;
  const valueKey = useTerminal ? 'terminalValue' : 'totalValue';

  const byTeam = new Map();
  for (const p of participants) {
    const v = Number(p[valueKey]) || 0;
    if (!byTeam.has(p.teamIndex)) byTeam.set(p.teamIndex, { total: 0, slots: [] });
    byTeam.get(p.teamIndex).total += v;
    byTeam.get(p.teamIndex).slots.push({ slotIndex: p.slotIndex, value: v });
  }

  let bestValue = useCrazy ? Infinity : -Infinity;
  const bestTeams = [];
  for (const [teamIndex, data] of byTeam) {
    const cmp = useCrazy ? data.total < bestValue : data.total > bestValue;
    if (cmp) {
      bestValue = data.total;
      bestTeams.length = 0;
      bestTeams.push(teamIndex);
    } else if (data.total === bestValue) {
      bestTeams.push(teamIndex);
    }
  }

  if (mode === 'jackpot') {
    return { winnerTeamIndex: null, payouts, jackpot: true, totalPotValue: totalValueOfAllItems };
  }

  if (bestTeams.length === 0) {
    const perPlayer = participants.length > 0 ? totalValueOfAllItems / participants.length : 0;
    payouts.forEach((p) => { p.amount = perPlayer; });
    return { winnerTeamIndex: null, payouts, isTie: true };
  }

  const winnerCount = participants.filter((p) => bestTeams.includes(p.teamIndex)).length;
  const amountPerWinner = winnerCount > 0 ? totalValueOfAllItems / winnerCount : 0;
  payouts.forEach((p) => {
    p.amount = bestTeams.includes(p.teamIndex) ? amountPerWinner : 0;
  });
  return { winnerTeamIndex: bestTeams[0], payouts, isTie: bestTeams.length > 1 };
}

/**
 * Jackpot: win chance = (team total value) / totalPotValue. Returns which team index won (0-based).
 * When crazyMode: lowest total gets highest % (inverted weights).
 * roll01: provably fair random in [0, 1).
 * @param {Array<{ teamIndex: number, totalValue: number }>} teamTotals - one entry per team with their total item value
 * @param {number} totalPotValue - sum of all items opened by everyone
 * @param {number} roll01 - random in [0, 1)
 * @param {{ crazyMode?: boolean }} opts - when true, lowest total gets highest win chance
 * @returns {number} winning team index
 */
function resolveJackpotWinner(teamTotals, totalPotValue, roll01, opts = {}) {
  if (!Number.isFinite(totalPotValue) || totalPotValue <= 0) {
    return 0;
  }
  const crazyMode = !!opts.crazyMode;
  const buckets = [];
  let cum = 0;
  if (crazyMode) {
    const weights = teamTotals.map((t) => Math.max(0, totalPotValue - (Number(t.totalValue) || 0)));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight <= 0) {
      return teamTotals[0]?.teamIndex ?? 0;
    }
    for (let i = 0; i < teamTotals.length; i++) {
      cum += weights[i] / totalWeight;
      buckets.push({ teamIndex: teamTotals[i].teamIndex, end: cum });
    }
  } else {
    for (const t of teamTotals) {
      const v = Math.max(0, Number(t.totalValue) || 0);
      cum += v;
      buckets.push({ teamIndex: t.teamIndex, end: cum / totalPotValue });
    }
  }
  const r = Number(roll01);
  for (let i = 0; i < buckets.length; i++) {
    if (r < buckets[i].end) return buckets[i].teamIndex;
  }
  return teamTotals[teamTotals.length - 1]?.teamIndex ?? 0;
}

module.exports = {
  validateProbabilities,
  expectedValue,
  calculateCasePrice,
  BATTLE_FORMATS,
  isAllowedFormat,
  resolveBattleResult,
  resolveJackpotWinner,
  PROB_TOLERANCE,
};

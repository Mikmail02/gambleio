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
 * participants: Array<{ teamIndex, slotIndex, totalValue, terminalValue, userId/username }>
 * totalPot: number (sum of all entry fees)
 * mode: 'standard' | 'terminal' | 'coop' | 'crazy_standard' | 'crazy_terminal' | 'jackpot'
 * For jackpot, also pass totalPotValue (sum of all items opened) and use provably fair roll separately.
 *
 * @param {Array<{ teamIndex: number, slotIndex: number, totalValue: number, terminalValue: number }>} participants
 * @param {number} totalPot
 * @param {string} mode
 * @param {{ totalPotValue?: number, winningTicketWeight?: number }} [opts] - for jackpot: total value of all items; optional precomputed weight for one side
 * @returns {{ winnerTeamIndex: number | null, payouts: Array<{ teamIndex, slotIndex, amount }>, isTie?: boolean }}
 */
function resolveBattleResult(participants, totalPot, mode, opts = {}) {
  const payouts = participants.map((p) => ({ teamIndex: p.teamIndex, slotIndex: p.slotIndex, amount: 0 }));

  if (mode === 'coop') {
    const perPlayer = totalPot / participants.length;
    payouts.forEach((p) => { p.amount = perPlayer; });
    return { winnerTeamIndex: null, payouts, isTie: false };
  }

  const useTerminal = mode === 'terminal' || mode === 'crazy_terminal';
  const useCrazy = mode === 'crazy_standard' || mode === 'crazy_terminal';
  const valueKey = useTerminal ? 'terminalValue' : 'totalValue';

  const byTeam = new Map();
  for (const p of participants) {
    const v = Number(p[valueKey]) || 0;
    if (!byTeam.has(p.teamIndex)) byTeam.set(p.teamIndex, { total: 0, slots: [] });
    byTeam.get(p.teamIndex).total += v;
    byTeam.get(p.teamIndex).slots.push({ slotIndex: p.slotIndex, value: v });
  }

  let bestTeam = null;
  let bestValue = useCrazy ? Infinity : -Infinity;
  let isTie = false;
  for (const [teamIndex, data] of byTeam) {
    const cmp = useCrazy ? data.total < bestValue : data.total > bestValue;
    if (cmp) {
      bestValue = data.total;
      bestTeam = teamIndex;
      isTie = false;
    } else if (data.total === bestValue && bestTeam !== null) {
      isTie = true;
    }
  }

  if (mode === 'jackpot') {
    return { winnerTeamIndex: null, payouts, jackpot: true, totalPotValue: opts.totalPotValue };
  }

  if (isTie || bestTeam === null) {
    const perPlayer = totalPot / participants.length;
    payouts.forEach((p) => { p.amount = perPlayer; });
    return { winnerTeamIndex: null, payouts, isTie: true };
  }

  const winnerSlots = participants.filter((p) => p.teamIndex === bestTeam).map((p) => p.slotIndex);
  payouts.forEach((p) => {
    p.amount = winnerSlots.includes(p.slotIndex) ? totalPot / winnerSlots.length : 0;
  });
  return { winnerTeamIndex: bestTeam, payouts, isTie: false };
}

/**
 * Jackpot: win chance = (team total value) / totalPotValue. Returns which team index won (0-based).
 * roll01: provably fair random in [0, 1).
 * @param {Array<{ teamIndex: number, totalValue: number }>} teamTotals - one entry per team with their total item value
 * @param {number} totalPotValue - sum of all items opened by everyone
 * @param {number} roll01 - random in [0, 1)
 * @returns {number} winning team index
 */
function resolveJackpotWinner(teamTotals, totalPotValue, roll01) {
  if (!Number.isFinite(totalPotValue) || totalPotValue <= 0) {
    return 0;
  }
  const buckets = [];
  let cum = 0;
  for (const t of teamTotals) {
    const v = Math.max(0, Number(t.totalValue) || 0);
    cum += v;
    buckets.push({ teamIndex: t.teamIndex, end: cum / totalPotValue });
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

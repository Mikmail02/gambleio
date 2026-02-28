/**
 * Game state: balance ($), bet, Plinko multipliers & odds, risk levels, clicker.
 * 18 slots. Odds: 0.01% edges → 20% center (mirrored), normalized to 100%.
 * Risk: Low (default), Medium, High, Extreme — each unlockable for a cost.
 */
const Game = {
  balance: 10_000,
  bet: 10,
  maxActiveBalls: 25,
  get clickEarning() { return this.getCurrentLevel(); },
  xpPerAction: 3,
  currentLevel: 1,
  xp: 0,
  totalGamblingWins: 0,
  totalClickEarnings: 0,
  totalBets: 0,
  totalWon: 0,
  totalClicks: 0,
  totalWinsCount: 0,
  biggestWinAmount: 0,
  biggestWinMultiplier: 1,

  /** Slot odds: 1% for 15x edges, increasing toward center. Sum = 100%. */
  getSlotOddsPercent() {
    // Left side: [1, 2, 3, 5, 7, 8, 10, 8, 6] then mirrored
    // This gives: 1% for 15x, 2% for 8.5x, 3% for 4.3x, 5% for 2.7x, 7% for 1.3x, 8% for 1.1x, 10% for 1x, 8% for 0.8x, 6% for 0.5x
    const left = [1, 2, 3, 5, 7, 8, 10, 8, 6];
    const right = [...left].reverse();
    return [...left, ...right];
  },

  /** Multipliers per risk. Same slot order: edges high, center low. */
  plinkoRisks: {
    low: {
      multipliers: [15, 8.5, 4.3, 2.7, 1.3, 1.1, 1, 0.8, 0.5, 0.5, 0.8, 1, 1.1, 1.3, 2.7, 4.3, 8.5, 15],
    },
    medium: {
      multipliers: [20, 10, 5, 2.5, 1.2, 1, 0.8, 0.6, 0.3, 0.3, 0.6, 0.8, 1, 1.2, 2.5, 5, 10, 20],
    },
    high: {
      multipliers: [50, 25, 10, 3, 1, 0.5, 0.3, 0.2, 0.1, 0.1, 0.2, 0.3, 0.5, 1, 3, 10, 25, 50],
    },
    extreme: {
      multipliers: [1000, 100, 20, 5, 1, 0.2, 0.1, 0.05, 0.01, 0.01, 0.05, 0.1, 0.2, 1, 5, 20, 100, 1000],
    },
  },
  plinkoRiskLevel: 'low',
  /** Unlock costs in $. Must buy in order: medium → high → extreme. */
  plinkoRiskCosts: { medium: 50_000, high: 500_000, extreme: 5_000_000 },
  plinkoRiskUnlocked: { medium: false, high: false, extreme: false },

  getMultipliers() {
    const risk = this.plinkoRisks[this.plinkoRiskLevel];
    return risk ? risk.multipliers : this.plinkoRisks.low.multipliers;
  },

  getMultiplier(slotIndex) {
    const mults = this.getMultipliers();
    if (slotIndex < 0 || slotIndex >= mults.length) return 0;
    return mults[slotIndex];
  },

  getSlotOdds() {
    return this.getSlotOddsPercent();
  },

  getRandomSlotIndex() {
    const odds = this.getSlotOdds();
    const r = Math.random() * 100;
    let sum = 0;
    for (let i = 0; i < odds.length; i++) {
      sum += odds[i];
      if (r < sum) return i;
    }
    return odds.length - 1;
  },

  /**
   * Backend: resolve Plinko outcome when user clicks bet.
   * Odds are calculated here; the result is then shown visually by the frontend physics.
   * Returns { slotIndex, multiplier } and deducts bet, or null if can't bet.
   */
  resolvePlinkoDrop() {
    const bet = this.getBet();
    if (!this.canBet(bet)) return null;
    const slotIndex = this.getRandomSlotIndex();
    const multiplier = this.getMultiplier(slotIndex);
    this.placeBet(bet);
    return { slotIndex, multiplier };
  },

  getPlinkoRiskLevel() {
    return this.plinkoRiskLevel;
  },

  setPlinkoRiskLevel(level) {
    if (level === 'low' || (level === 'medium' && this.plinkoRiskUnlocked.medium) ||
        (level === 'high' && this.plinkoRiskUnlocked.high) ||
        (level === 'extreme' && this.plinkoRiskUnlocked.extreme)) {
      this.plinkoRiskLevel = level;
      return true;
    }
    return false;
  },

  canUnlockPlinkoRisk(level) {
    if (level === 'medium') return !this.plinkoRiskUnlocked.medium && this.balance >= this.plinkoRiskCosts.medium;
    if (level === 'high') return this.plinkoRiskUnlocked.medium && !this.plinkoRiskUnlocked.high && this.balance >= this.plinkoRiskCosts.high;
    if (level === 'extreme') return this.plinkoRiskUnlocked.high && !this.plinkoRiskUnlocked.extreme && this.balance >= this.plinkoRiskCosts.extreme;
    return false;
  },

  unlockPlinkoRisk(level) {
    if (!this.canUnlockPlinkoRisk(level)) return false;
    const cost = this.plinkoRiskCosts[level];
    if (this.balance < cost) return false;
    this.balance -= cost;
    this.plinkoRiskUnlocked[level] = true;
    this.plinkoRiskLevel = level;
    return true;
  },

  canBet(amount) {
    return amount >= 0.01 && amount <= this.balance;
  },

  placeBet(amount) {
    if (!this.canBet(amount)) return false;
    this.balance -= amount;
    this.rewardBetXP();
    return true;
  },

  win(amount, multiplier, betAmount) {
    this.balance += amount;
    if (amount > 0) {
      this.totalWon += amount;
      const isProfit = betAmount != null ? amount > betAmount : true;
      if (isProfit) {
        this.totalWinsCount = (this.totalWinsCount || 0) + 1;
      }
      if (amount > (this.biggestWinAmount || 0) && isProfit) {
        this.biggestWinAmount = amount;
        this.biggestWinMultiplier = multiplier || 1;
      }
      if (isProfit) this.rewardWinXP();
    }
  },

  recordBet() {
    this.totalBets++;
  },

  getTotalBets() {
    return this.totalBets ?? 0;
  },

  getTotalWon() {
    return this.totalWon ?? 0;
  },

  setBet(amount) {
    const n = Number(amount);
    if (Number.isFinite(n) && n >= 0.01) this.bet = Math.max(0.01, Math.round(n * 100) / 100);
  },

  getBet() {
    return this.bet;
  },

  getBalance() {
    return this.balance;
  },

  addClickEarnings() {
    this.balance += this.clickEarning;
    this.totalClickEarnings += this.clickEarning;
    this.totalClicks = (this.totalClicks || 0) + 1;
    this.rewardClickXP();
  },

  rewardBetXP() {
    this.addXP(this.xpPerAction);
  },

  rewardWinXP() {
    this.addXP(this.xpPerAction);
  },

  rewardClickXP() {
    this.addXP(this.xpPerAction);
  },

  getLevelFromXp(xpValue) {
    const x = Math.max(0, xpValue);
    const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * x / 500)) / 2));
    return level;
  },

  recalculateLevelFromXp() {
    this.currentLevel = this.getLevelFromXp(this.xp || 0);
    return this.currentLevel;
  },

  addXP(amount = 1) {
    const delta = Math.max(0, Number(amount) || 0);
    if (!delta) return this.currentLevel;
    this.xp = (this.xp || 0) + delta;
    const prevLevel = this.currentLevel;
    const nextLevel = this.recalculateLevelFromXp();
    if (window.Stats && window.Stats.syncStats) {
      window.Stats.syncStats();
    }
    if (window.Auth && window.Auth.updateProfileStats) {
      window.Auth.updateProfileStats();
    }
    if (window.Auth && window.Auth.refreshRankBadge) {
      window.Auth.refreshRankBadge();
    }
    if (nextLevel > prevLevel) {
      console.log(`[XP] Level up: ${prevLevel} -> ${nextLevel}`);
    }
    return nextLevel;
  },

  getXp() {
    return this.xp || 0;
  },

  getXpProgressInLevel() {
    const xp = this.getXp();
    const currentLevel = this.getCurrentLevel();
    const currentLevelStart = 500 * currentLevel * (currentLevel - 1);
    const needed = 1000 * currentLevel;
    const nextLevelStart = currentLevelStart + needed;
    return {
      inLevel: xp - currentLevelStart,
      needed,
      currentLevelStart,
      nextLevelStart,
    };
  },

  getCurrentLevel() {
    return Math.max(1, this.currentLevel || 1);
  },

  getRankInfoForXp(xp) {
    const level = this.getLevelFromXp(xp || 0);
    const titles = ['Noob', 'Amateur', 'Addict', 'Addicted', 'Degen'];
    const romans = ['V', 'IV', 'III', 'II', 'I'];
    const rankLevel = Math.min(level, 25);
    const zeroBased = rankLevel - 1;
    const titleIndex = Math.min(titles.length - 1, Math.floor(zeroBased / 5));
    const divisionIndex = zeroBased % 5;
    return {
      level,
      rankLevel,
      title: titles[titleIndex],
      division: 5 - divisionIndex,
      roman: romans[divisionIndex],
      tierIndex: titleIndex,
      badgeClass: `rank-tier-${titles[titleIndex].toLowerCase()} rank-div-${5 - divisionIndex}`,
      label: `${titles[titleIndex]} ${romans[divisionIndex]}`,
      isMaxRank: level >= 25,
    };
  },

  getRankInfo() {
    const titles = ['Noob', 'Amateur', 'Addict', 'Addicted', 'Degen'];
    const romans = ['V', 'IV', 'III', 'II', 'I'];
    const level = this.getCurrentLevel();
    const rankLevel = Math.min(level, 25);
    const zeroBased = rankLevel - 1;
    const titleIndex = Math.min(titles.length - 1, Math.floor(zeroBased / 5));
    const divisionIndex = zeroBased % 5;
    const division = 5 - divisionIndex;
    return {
      level,
      rankLevel,
      title: titles[titleIndex],
      division,
      roman: romans[divisionIndex],
      tierIndex: titleIndex,
      badgeClass: `rank-tier-${titles[titleIndex].toLowerCase()} rank-div-${division}`,
      label: `${titles[titleIndex]} ${romans[divisionIndex]}`,
      isMaxRank: level >= 25,
    };
  },
};

// Expose Game for modules that check window.Game (auth/stats/UI sync).
if (typeof window !== 'undefined') {
  window.Game = Game;
}

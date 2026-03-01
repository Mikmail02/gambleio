/**
 * Stats sync with backend. Server is source of truth for balance.
 * Auto-re-authenticates on 401 (expired session after server restart).
 * Caches xp/level in localStorage so refresh doesn't reset before loadStats completes.
 */
const Stats = {
  apiBase: '/api',
  syncDebounce: 250,
  syncTimer: null,
  _syncInFlight: false,
  _syncQueued: false,
  _reAuthInProgress: null,
  GAME_STATS_KEY: 'gambleio_game_stats',

  _restoreFromCache() {
    try {
      const raw = localStorage.getItem(this.GAME_STATS_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (cached && typeof cached === 'object') {
        if (cached.xp !== undefined) Game.xp = cached.xp;
        if (cached.level !== undefined) Game.currentLevel = cached.level;
        if (cached.balance !== undefined) Game.balance = cached.balance;
        if (cached.totalGamblingWins !== undefined) Game.totalGamblingWins = cached.totalGamblingWins;
        if (cached.totalClickEarnings !== undefined) Game.totalClickEarnings = cached.totalClickEarnings;
        if (cached.totalBets !== undefined) Game.totalBets = cached.totalBets;
        if (cached.totalClicks !== undefined) Game.totalClicks = cached.totalClicks;
        if (cached.totalWinsCount !== undefined) Game.totalWinsCount = cached.totalWinsCount;
        if (cached.biggestWinAmount !== undefined) Game.biggestWinAmount = cached.biggestWinAmount;
        if (cached.biggestWinMultiplier !== undefined) Game.biggestWinMultiplier = cached.biggestWinMultiplier;
        if (cached.plinkoRiskLevel !== undefined) Game.plinkoRiskLevel = cached.plinkoRiskLevel;
        if (cached.plinkoRiskUnlocked !== undefined) Game.plinkoRiskUnlocked = cached.plinkoRiskUnlocked;
        Game.totalWon = Game.totalGamblingWins ?? 0;
        if (Game.recalculateLevelFromXp) Game.recalculateLevelFromXp();
        return cached;
      }
    } catch (e) { /* ignore */ }
    return null;
  },

  _saveToCache() {
    try {
      localStorage.setItem(this.GAME_STATS_KEY, JSON.stringify({
        xp: Game.xp,
        level: Game.currentLevel,
        balance: Game.balance,
        totalGamblingWins: Game.totalGamblingWins,
        totalClickEarnings: Game.totalClickEarnings,
        totalBets: Game.totalBets,
        totalClicks: Game.totalClicks,
        totalWinsCount: Game.totalWinsCount,
        biggestWinAmount: Game.biggestWinAmount,
        biggestWinMultiplier: Game.biggestWinMultiplier,
        plinkoRiskLevel: Game.plinkoRiskLevel,
        plinkoRiskUnlocked: Game.plinkoRiskUnlocked,
        updatedAt: Date.now(),
      }));
    } catch (e) { /* ignore */ }
  },

  // --- Auto re-auth: if server session expired, re-login using stored credentials ---
  async _reAuth() {
    if (this._reAuthInProgress) return this._reAuthInProgress;
    this._reAuthInProgress = (async () => {
      try {
        const userStr = localStorage.getItem('gambleio_user');
        const usersStr = localStorage.getItem('gambleio_users');
        if (!userStr || !usersStr) return false;
        const user = JSON.parse(userStr);
        const allUsers = JSON.parse(usersStr);
        const email = user.email || user.username;
        if (!email || !allUsers[email]) return false;
        const password = allUsers[email].password;
        const res = await fetch(`${this.apiBase}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: email, password }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.token) {
          localStorage.setItem('gambleio_token', data.token);
          return true;
        }
      } catch (e) {
        console.warn('Re-auth failed:', e.message);
      }
      return false;
    })();
    const result = await this._reAuthInProgress;
    this._reAuthInProgress = null;
    return result;
  },

  _headers() {
    return {
      'Content-Type': 'application/json',
      ...(window.Auth ? window.Auth.getAuthHeaders() : {}),
    };
  },

  // --- Fetch with auto-retry on 401 ---
  async _fetch(url, opts) {
    let res = await fetch(url, opts);
    if (res.status === 401) {
      const ok = await this._reAuth();
      if (ok) {
        if (opts.headers) opts.headers = this._headers();
        res = await fetch(url, opts);
      } else {
        if (window.Auth && window.Auth.onSessionExpired) {
          window.Auth.onSessionExpired();
        }
      }
    }
    return res;
  },

  // --- Sync only non-delta fields (xp, level, biggestWin) ---
  async syncStats() {
    if (!window.Auth || !window.Auth.isAuthenticated()) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this._doSync(), this.syncDebounce);
  },

  async _doSync() {
    if (this._syncInFlight) {
      this._syncQueued = true;
      return;
    }
    this._syncInFlight = true;
    try {
      const res = await this._fetch(`${this.apiBase}/user/update-stats`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({
          level: Game.currentLevel,
          xp: Game.xp || 0,
          biggestWinAmount: Game.biggestWinAmount || 0,
          biggestWinMultiplier: Game.biggestWinMultiplier || 1,
        }),
      });
      if (res && res.ok) this._saveToCache();
    } catch (error) {
      console.error('Failed to sync stats:', error);
    } finally {
      this._syncInFlight = false;
      if (this._syncQueued) {
        this._syncQueued = false;
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => this._doSync(), 0);
      }
    }
  },

  async loadStats() {
    if (!window.Auth || !window.Auth.isAuthenticated()) return;
    const cached = this._restoreFromCache();
    try {
      const res = await this._fetch(`${this.apiBase}/user/stats`, {
        headers: this._headers(),
      });
      if (!res.ok) return;
      const stats = await res.json();
      const serverXp = Number(stats.xp ?? 0);
      const cachedXp = Number(cached?.xp ?? 0);
      const preferCachedXp = cachedXp > serverXp;

      Game.balance = stats.balance ?? Game.balance;
      Game.totalGamblingWins = stats.totalGamblingWins ?? 0;
      Game.totalClickEarnings = stats.totalClickEarnings ?? 0;
      Game.totalBets = stats.totalBets ?? 0;
      Game.totalWon = stats.totalGamblingWins ?? 0;
      Game.currentLevel = preferCachedXp ? (cached?.level ?? stats.level ?? 1) : (stats.level ?? 1);
      Game.xp = preferCachedXp ? cachedXp : serverXp;
      Game.totalClicks = stats.totalClicks ?? 0;
      Game.totalWinsCount = stats.totalWinsCount ?? 0;
      Game.biggestWinAmount = stats.biggestWinAmount ?? 0;
      Game.biggestWinMultiplier = stats.biggestWinMultiplier ?? 1;
      Game.plinkoRiskLevel = stats.plinkoRiskLevel ?? Game.plinkoRiskLevel ?? 'low';
      Game.plinkoRiskUnlocked = stats.plinkoRiskUnlocked ?? Game.plinkoRiskUnlocked ?? { medium: false, high: false, extreme: false };
      if (Game.recalculateLevelFromXp) Game.recalculateLevelFromXp();
      this._saveToCache();
      if (preferCachedXp) {
        this.syncStats();
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  },

  /** Place a bet: server deducts balance. */
  async placeBet(amount) {
    if (!window.Auth || !window.Auth.isAuthenticated()) {
      return Game.placeBet(amount) ? { balance: Game.balance } : null;
    }
    try {
      const res = await this._fetch(`${this.apiBase}/user/place-bet`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      Game.balance = data.balance;
      Game.totalBets = data.totalBets ?? Game.totalBets;
      if (Game.rewardBetXP) Game.rewardBetXP();
      return data;
    } catch (e) {
      console.error('placeBet API failed:', e);
      return null;
    }
  },

  /** Record a win with amount, multiplier, and betAmount (only count as win when amount > betAmount). */
  async win(amount, multiplier, betAmount) {
    if (!window.Auth || !window.Auth.isAuthenticated()) {
      Game.win(amount, multiplier, betAmount);
      return { balance: Game.balance };
    }
    try {
      const res = await this._fetch(`${this.apiBase}/user/win`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ amount, multiplier: multiplier ?? null, betAmount: betAmount ?? null }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      Game.balance = data.balance;
      Game.totalGamblingWins = data.totalGamblingWins ?? Game.totalGamblingWins;
      if (amount > 0) {
        Game.totalWon = (Game.totalWon || 0) + amount;
        Game.totalWinsCount = data.totalWinsCount ?? Game.totalWinsCount;
        Game.biggestWinAmount = data.biggestWinAmount ?? Game.biggestWinAmount;
        Game.biggestWinMultiplier = data.biggestWinMultiplier ?? Game.biggestWinMultiplier;
      }
      const isProfit = betAmount != null ? amount > betAmount : true;
      if (amount > 0 && isProfit && Game.rewardWinXP) Game.rewardWinXP();
      return data;
    } catch (e) {
      console.error('win API failed:', e);
      return null;
    }
  },

  /** Refund: return money to balance without counting as a win. */
  async refund(amount) {
    if (!window.Auth || !window.Auth.isAuthenticated()) {
      Game.balance += amount;
      return { balance: Game.balance };
    }
    try {
      const res = await this._fetch(`${this.apiBase}/user/refund`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      Game.balance = data.balance;
      return data;
    } catch (e) {
      console.error('refund API failed:', e);
      return null;
    }
  },

  async recordPlinkoLand(slotIndex, bet, multiplier) {
    if (!window.Auth || !window.Auth.isAuthenticated()) return;
    try {
      await this._fetch(`${this.apiBase}/plinko-land`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ slotIndex, bet, multiplier }),
      });
    } catch (e) {
      console.warn('recordPlinkoLand failed:', e.message);
    }
  },

  async setPlinkoRiskLevel(level) {
    const normalized = String(level || '').toLowerCase().trim();
    if (!['low', 'medium', 'high', 'extreme'].includes(normalized)) {
      return { error: 'Invalid risk level' };
    }
    if (!window.Auth || !window.Auth.isAuthenticated()) {
      if (normalized === 'low') {
        Game.setPlinkoRiskLevel('low');
        return { ok: true, local: true };
      }
      if (Game.plinkoRiskUnlocked[normalized]) {
        Game.setPlinkoRiskLevel(normalized);
        return { ok: true, local: true };
      }
      if (Game.unlockPlinkoRisk(normalized)) {
        return { ok: true, local: true };
      }
      return { error: 'Unable to unlock risk level' };
    }
    try {
      const res = await this._fetch(`${this.apiBase}/plinko/risk-level`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ level: normalized }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { error: err.error || 'Unable to set risk level' };
      }
      const data = await res.json();
      Game.balance = data.balance ?? Game.balance;
      Game.plinkoRiskLevel = data.plinkoRiskLevel ?? Game.plinkoRiskLevel;
      Game.plinkoRiskUnlocked = data.plinkoRiskUnlocked ?? Game.plinkoRiskUnlocked;
      this._saveToCache();
      return { ok: true, data };
    } catch (e) {
      return { error: 'Unable to set risk level' };
    }
  },

  /** Send accumulated click earnings to server. */
  async sendClickEarnings(amount, clickCount) {
    if (!window.Auth || !window.Auth.isAuthenticated() || !(amount > 0)) return null;
    try {
      const res = await this._fetch(`${this.apiBase}/user/click-earnings`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ amount, clickCount: clickCount || 0 }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      Game.balance = data.balance;
      Game.totalClickEarnings = data.totalClickEarnings ?? Game.totalClickEarnings;
      Game.totalClicks = data.totalClicks ?? Game.totalClicks;
      return data;
    } catch (e) {
      console.error('click-earnings API failed:', e);
      return null;
    }
  },

  onLocalStatsChanged() {
    this._saveToCache();
    this.syncStats();
  },
};

window.Stats = Stats;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Stats._saveToCache();
    if (window.Auth && window.Auth.isAuthenticated && window.Auth.isAuthenticated()) {
      Stats.syncStats();
    }
  }
});

window.addEventListener('beforeunload', () => {
  Stats._saveToCache();
});

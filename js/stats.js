/**
 * Stats sync with backend. Server is source of truth for balance.
 * Auto-re-authenticates on 401 (expired session after server restart).
 */
const Stats = {
  apiBase: '/api',
  syncDebounce: 2000,
  syncTimer: null,
  _reAuthInProgress: null,

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
        // Rebuild headers with new token
        if (opts.headers) {
          opts.headers = this._headers();
        }
        res = await fetch(url, opts);
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
    try {
      await this._fetch(`${this.apiBase}/user/update-stats`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({
          level: Game.currentLevel,
          xp: Game.xp || 0,
          biggestWinAmount: Game.biggestWinAmount || 0,
          biggestWinMultiplier: Game.biggestWinMultiplier || 1,
        }),
      });
    } catch (error) {
      console.error('Failed to sync stats:', error);
    }
  },

  async loadStats() {
    if (!window.Auth || !window.Auth.isAuthenticated()) return;
    try {
      const res = await this._fetch(`${this.apiBase}/user/stats`, {
        headers: this._headers(),
      });
      if (!res.ok) return;
      const stats = await res.json();
      Game.balance = stats.balance ?? Game.balance;
      Game.totalGamblingWins = stats.totalGamblingWins ?? 0;
      Game.totalClickEarnings = stats.totalClickEarnings ?? 0;
      Game.totalBets = stats.totalBets ?? 0;
      Game.totalWon = stats.totalGamblingWins ?? 0;
      Game.currentLevel = stats.level ?? 1;
      Game.xp = stats.xp ?? 0;
      Game.totalClicks = stats.totalClicks ?? 0;
      Game.totalWinsCount = stats.totalWinsCount ?? 0;
      Game.biggestWinAmount = stats.biggestWinAmount ?? 0;
      Game.biggestWinMultiplier = stats.biggestWinMultiplier ?? 1;
      if (Game.recalculateLevelFromXp) Game.recalculateLevelFromXp();
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

  /** Record a win with amount and multiplier. */
  async win(amount, multiplier) {
    if (!window.Auth || !window.Auth.isAuthenticated()) {
      Game.win(amount, multiplier);
      return { balance: Game.balance };
    }
    try {
      const res = await this._fetch(`${this.apiBase}/user/win`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ amount, multiplier: multiplier ?? null }),
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
      if (amount > 0 && Game.rewardWinXP) Game.rewardWinXP();
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
};

window.Stats = Stats;

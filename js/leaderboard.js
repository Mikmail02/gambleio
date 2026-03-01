/**
 * Leaderboard: fetch and display rankings by clicks, wins, biggest win, XP, level.
 */
const Leaderboard = {
  apiBase: '/api',
  currentTab: 'clicks',
  selectedProfileSlug: null,
  _boundListClick: false,

  getDetailEls() {
    return {
      shell: document.getElementById('leaderboardStage'),
      panel: document.getElementById('leaderboardDetailPanel'),
      body: document.getElementById('leaderboardDetailBody'),
      title: document.getElementById('leaderboardDetailTitle'),
      close: document.getElementById('leaderboardDetailClose'),
    };
  },

  async load(type) {
    try {
      const res = await fetch(`${this.apiBase}/leaderboard/${type}`);
      if (!res.ok) throw new Error('Failed to load leaderboard');
      const data = await res.json();
      return { ok: true, data: Array.isArray(data) ? data : [] };
    } catch (error) {
      console.error('Leaderboard error:', error);
      return { ok: false, data: [] };
    }
  },

  async loadDetail(type, profileSlug) {
    try {
      const res = await fetch(`${this.apiBase}/leaderboard/${type}/user/${encodeURIComponent(profileSlug)}`);
      if (!res.ok) throw new Error('Failed to load detail');
      const data = await res.json();
      return { ok: true, data };
    } catch (error) {
      console.error('Leaderboard detail error:', error);
      return { ok: false, data: null };
    }
  },

  closeDetail() {
    const { shell, panel, body, title } = this.getDetailEls();
    this.selectedProfileSlug = null;
    if (shell) shell.classList.remove('has-detail');
    if (panel) panel.classList.remove('is-open');
    if (title) title.textContent = 'Player details';
    if (body) body.innerHTML = '<div class="leaderboard-detail-empty">Click a leaderboard row to view detailed stats.</div>';
  },

  renderDetailCards(detail) {
    const cards = [];
    const fmtNumber = (n) => new Intl.NumberFormat('en').format(Number(n) || 0);
    const fmtDollar = (n) => '$' + new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(Number(n) || 0);
    const fmtDate = (ts) => ts ? new Date(ts).toLocaleString() : 'N/A';
    const topGames = (detail.topGames || []).map((g) => escapeHtml(g)).join(' • ') || 'N/A';

    cards.push(`
      <div class="leaderboard-detail-card">
        <div class="leaderboard-detail-card-key">Player</div>
        <div class="leaderboard-detail-card-value">${escapeHtml(detail.displayName || detail.username || 'Unknown')}</div>
      </div>
    `);
    cards.push(`
      <div class="leaderboard-detail-card">
        <div class="leaderboard-detail-card-key">Rank</div>
        <div class="leaderboard-detail-card-value">#${fmtNumber(detail.rank)}</div>
      </div>
    `);

    if (detail.type === 'clicks') {
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Total Clicks</div>
          <div class="leaderboard-detail-card-value">${fmtNumber(detail.totalClicks)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Click Earnings</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.totalClickEarnings)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Avg Clicks / Day</div>
          <div class="leaderboard-detail-card-value">${fmtNumber(detail.avgClicksPerDay)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Top 3 Games Played</div>
          <div class="leaderboard-detail-card-value">${topGames}</div>
        </div>
      `);
    } else if (detail.type === 'wins') {
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Total Wins</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.totalGamblingWins)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Profit from Wins</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.totalProfitWins)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Top 3 Games Played</div>
          <div class="leaderboard-detail-card-value">${topGames}</div>
        </div>
      `);
    } else if (detail.type === 'biggest-win') {
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Biggest Win</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.biggestWinAmount)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Multiplier</div>
          <div class="leaderboard-detail-card-value">${formatMultiplier(detail.biggestWinMultiplier)}×</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Bet Size</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.biggestWinBetAmount)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Game</div>
          <div class="leaderboard-detail-card-value">${escapeHtml(detail.biggestWinGame || 'N/A')}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">When</div>
          <div class="leaderboard-detail-card-value">${escapeHtml(fmtDate(detail.biggestWinTimestamp))}</div>
        </div>
      `);
    } else if (detail.type === 'networth') {
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Networth</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.balance)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">From Click</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.netByGame?.click)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">From Plinko</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.netByGame?.plinko)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">From Roulette</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.netByGame?.roulette)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">From Slots</div>
          <div class="leaderboard-detail-card-value">${fmtDollar(detail.netByGame?.slots)}</div>
        </div>
      `);
    } else if (detail.type === 'xp' || detail.type === 'level') {
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Level</div>
          <div class="leaderboard-detail-card-value">Lv ${fmtNumber(detail.level)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">Total XP</div>
          <div class="leaderboard-detail-card-value">${fmtNumber(detail.xp)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">XP from Click</div>
          <div class="leaderboard-detail-card-value">${fmtNumber(detail.xpBySource?.click)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">XP from Plinko</div>
          <div class="leaderboard-detail-card-value">${fmtNumber(detail.xpBySource?.plinko)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">XP from Roulette</div>
          <div class="leaderboard-detail-card-value">${fmtNumber(detail.xpBySource?.roulette)}</div>
        </div>
      `);
      cards.push(`
        <div class="leaderboard-detail-card">
          <div class="leaderboard-detail-card-key">XP from Slots</div>
          <div class="leaderboard-detail-card-value">${fmtNumber(detail.xpBySource?.slots)}</div>
        </div>
      `);
    }

    return cards.join('');
  },

  async openDetail(profileSlug, type) {
    const { shell, panel, body, title } = this.getDetailEls();
    if (!panel || !body || !title || !profileSlug) return;
    this.selectedProfileSlug = profileSlug;
    title.textContent = 'Loading details...';
    body.innerHTML = '<div class="leaderboard-detail-empty">Loading...</div>';
    panel.classList.add('is-open');
    if (shell) shell.classList.add('has-detail');

    const result = await this.loadDetail(type, profileSlug);
    if (!result.ok || !result.data) {
      title.textContent = 'Player details';
      body.innerHTML = '<div class="leaderboard-detail-empty">Could not load detail stats.</div>';
      return;
    }
    const detail = result.data;
    title.textContent = `${detail.displayName || detail.username || 'Player'} details`;
    body.innerHTML = this.renderDetailCards(detail);
  },

  bindDetailUi() {
    if (this._boundListClick) return;
    const container = document.getElementById('leaderboardList');
    const { close } = this.getDetailEls();
    if (!container) return;

    container.addEventListener('click', (e) => {
      const link = e.target.closest('.leaderboard-username-link');
      if (link) return;
      const row = e.target.closest('.leaderboard-item');
      if (!row) return;
      const slug = row.getAttribute('data-profile-slug');
      if (!slug) return;
      this.openDetail(slug, this.currentTab);
    });

    if (close) {
      close.addEventListener('click', () => this.closeDetail());
    }
    this._boundListClick = true;
  },

  async render(type, container) {
    if (!container) return;
    container.innerHTML = '<div class="leaderboard-loading">Loading...</div>';
    const result = await this.load(type);
    if (!result.ok) {
      container.innerHTML = '<div class="leaderboard-empty">Could not load leaderboard. Make sure the server is running (node server.js).</div>';
      return;
    }
    const data = result.data;
    if (data.length === 0) {
      container.innerHTML = '<div class="leaderboard-empty">No data yet. Play games and sign up to appear on the leaderboard!</div>';
      return;
    }
    const currentUser = window.Auth && window.Auth.user ? window.Auth.user.username : null;
    container.innerHTML = data.map((user, idx) => {
      const rank = idx + 1;
      const isCurrentUser = user.username === currentUser;
      let value;
      let subValue = '';

      if (type === 'clicks') {
        value = formatNumber(user.totalClicks) + ' clicks';
      } else if (type === 'wins') {
        value = formatDollars(user.totalGamblingWins || 0);
      } else if (type === 'biggest-win') {
        value = formatDollars(user.biggestWinAmount || 0);
        if (user.biggestWinMultiplier && user.biggestWinMultiplier > 0) {
          subValue = `<span class="leaderboard-multiplier">${formatMultiplier(user.biggestWinMultiplier)}&times;</span>`;
        }
      } else if (type === 'xp') {
        value = formatNumber(user.xp) + ' XP';
      } else if (type === 'networth') {
        value = formatDollars(user.balance ?? 0);
      } else if (type === 'level') {
        value = `Lv ${user.level}`;
        subValue = `<span class="leaderboard-xp-sub">${formatNumber(user.xp)} XP</span>`;
      }

      const podiumClass = rank === 1 ? 'leaderboard-item-gold' : rank === 2 ? 'leaderboard-item-silver' : rank === 3 ? 'leaderboard-item-bronze' : '';
      const classes = ['leaderboard-item', 'is-clickable', podiumClass, isCurrentUser ? 'leaderboard-item-current' : ''].filter(Boolean).join(' ');
      const displayName = escapeHtml(user.displayName || user.username);
      const profileSlug = user.profileSlug || user.username;
      const usernameLink = `<a href="#profile/${encodeURIComponent(profileSlug)}" class="leaderboard-username leaderboard-username-link" data-username="${escapeHtml(user.username)}">${displayName}</a>`;

      return `
        <div class="${classes}" data-profile-slug="${escapeHtml(profileSlug)}" data-username="${escapeHtml(user.username)}">
          <span class="leaderboard-rank">${rankIcon(rank)}</span>
          <span class="leaderboard-username-cell">${usernameLink}</span>
          <span class="leaderboard-value">${value}${subValue}</span>
        </div>
      `;
    }).join('');

    this.bindDetailUi();
  },

  async switchTab(type) {
    this.currentTab = type;
    const container = document.getElementById('leaderboardList');
    if (!container) return;
    document.querySelectorAll('.leaderboard-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === type);
    });
    await this.render(type, container);
    this.closeDetail();
  },
};

function rankIcon(rank) {
  if (rank === 1) return '<span class="rank-gold">#1</span>';
  if (rank === 2) return '<span class="rank-silver">#2</span>';
  if (rank === 3) return '<span class="rank-bronze">#3</span>';
  return `#${rank}`;
}

function formatDollars(n) {
  return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

function formatNumber(n) {
  return new Intl.NumberFormat('en').format(n || 0);
}

function formatMultiplier(n) {
  if (!n || !isFinite(n)) return '1';
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.Leaderboard = Leaderboard;

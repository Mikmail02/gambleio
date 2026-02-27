/**
 * Leaderboard: fetch and display rankings by clicks, wins, biggest win, XP, level.
 */
const Leaderboard = {
  apiBase: '/api',
  currentTab: 'clicks',

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
      } else if (type === 'level') {
        value = `Lv ${user.level}`;
        subValue = `<span class="leaderboard-xp-sub">${formatNumber(user.xp)} XP</span>`;
      }

      const podiumClass = rank === 1 ? 'leaderboard-item-gold' : rank === 2 ? 'leaderboard-item-silver' : rank === 3 ? 'leaderboard-item-bronze' : '';
      const classes = ['leaderboard-item', podiumClass, isCurrentUser ? 'leaderboard-item-current' : ''].filter(Boolean).join(' ');

      return `
        <div class="${classes}">
          <span class="leaderboard-rank">${rankIcon(rank)}</span>
          <span class="leaderboard-username">${escapeHtml(user.displayName || user.username)}</span>
          <span class="leaderboard-value">${value}${subValue}</span>
        </div>
      `;
    }).join('');
  },

  async switchTab(type) {
    this.currentTab = type;
    const container = document.getElementById('leaderboardList');
    if (!container) return;
    document.querySelectorAll('.leaderboard-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === type);
    });
    await this.render(type, container);
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

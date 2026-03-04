/**
 * Live Stats: Session profit/loss tracker per game. Resets on refresh.
 * Popup with dropdown (All Games / individual), Profit, Wagered, Wins, Losses.
 */
(function () {
  const GAME_IDS = ['plinko', 'mines', 'crash', 'roulette', 'slots'];
  const GAME_NAMES = { plinko: 'Plinko', mines: 'Mines', crash: 'Crash', roulette: 'Roulette', slots: 'Slots' };

  let session = {};
  let history = []; // For graph: { t, profit } per data point
  let lastHistoryT = 0;

  function ensureGame(id) {
    if (!session[id]) {
      session[id] = { wagered: 0, profit: 0, wins: 0, losses: 0 };
    }
    return session[id];
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }

  window.LiveStats = {
    recordRound(gameId, betAmount, winAmount) {
      const g = ensureGame(gameId);
      g.wagered += betAmount;
      const profit = (winAmount || 0) - betAmount;
      g.profit += profit;
      if (profit > 0) g.wins++;
      else g.losses++;

      const totalProfit = Object.values(session).reduce((s, x) => s + x.profit, 0);
      const now = Date.now();
      if (now - lastHistoryT > 500 || history.length === 0) {
        history.push({ t: now, profit: totalProfit });
        lastHistoryT = now;
      }
      const popup = document.getElementById('liveStatsPopup');
      if (popup && !popup.classList.contains('hidden') && window.LiveStats && window.LiveStats.render) {
        window.LiveStats.render();
      }
    },

    /** For crash/slots: subtract bet when placing. On crash/loss: do nothing. On win: add payout. */
    recordBetPlaced(gameId, betAmount) {
      const g = ensureGame(gameId);
      g.wagered += betAmount;
      g.profit -= betAmount;

      const totalProfit = Object.values(session).reduce((s, x) => s + x.profit, 0);
      const now = Date.now();
      if (now - lastHistoryT > 500 || history.length === 0) {
        history.push({ t: now, profit: totalProfit });
        lastHistoryT = now;
      }
      const popup = document.getElementById('liveStatsPopup');
      if (popup && !popup.classList.contains('hidden') && window.LiveStats && window.LiveStats.render) {
        window.LiveStats.render();
      }
    },

    recordWin(gameId, winAmount) {
      const g = ensureGame(gameId);
      g.profit += winAmount;
      g.wins++;

      const totalProfit = Object.values(session).reduce((s, x) => s + x.profit, 0);
      const now = Date.now();
      if (now - lastHistoryT > 500 || history.length === 0) {
        history.push({ t: now, profit: totalProfit });
        lastHistoryT = now;
      }
      const popup = document.getElementById('liveStatsPopup');
      if (popup && !popup.classList.contains('hidden') && window.LiveStats && window.LiveStats.render) {
        window.LiveStats.render();
      }
    },

    refresh() {
      session = {};
      history = [];
      lastHistoryT = 0;
      if (window.LiveStats && window.LiveStats.render) window.LiveStats.render();
    },

    getSession() {
      return { ...session };
    },

    getHistory() {
      return [...history];
    },

    getAggregate(gameId) {
      if (gameId === 'all') {
        return Object.values(session).reduce(
          (a, g) => ({
            wagered: a.wagered + g.wagered,
            profit: a.profit + g.profit,
            wins: a.wins + g.wins,
            losses: a.losses + g.losses,
          }),
          { wagered: 0, profit: 0, wins: 0, losses: 0 }
        );
      }
      const g = session[gameId];
      return g ? { ...g } : { wagered: 0, profit: 0, wins: 0, losses: 0 };
    },

    open(currentGameId) {
      const popup = document.getElementById('liveStatsPopup');
      if (!popup) return;
      popup.classList.remove('hidden');
      const sel = document.getElementById('liveStatsGameSelect');
      if (sel) {
        sel.innerHTML = '';
        const optAll = document.createElement('option');
        optAll.value = 'all';
        optAll.textContent = 'All Games';
        sel.appendChild(optAll);
        const played = GAME_IDS.filter((id) => session[id] && (session[id].wagered > 0 || session[id].wins > 0 || session[id].losses > 0));
        played.forEach((id) => {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = GAME_NAMES[id] || id;
          sel.appendChild(opt);
        });
        sel.value = played.includes(currentGameId) ? currentGameId : 'all';
      }
      this.render();
    },

    close() {
      const popup = document.getElementById('liveStatsPopup');
      if (popup) popup.classList.add('hidden');
    },

    render() {
      const sel = document.getElementById('liveStatsGameSelect');
      const gameId = sel ? sel.value : 'all';
      const agg = this.getAggregate(gameId);

      const profitEl = document.getElementById('liveStatsProfit');
      const wageredEl = document.getElementById('liveStatsWagered');
      const winsEl = document.getElementById('liveStatsWins');
      const lossesEl = document.getElementById('liveStatsLosses');

      if (profitEl) {
        profitEl.textContent = formatDollars(agg.profit);
        profitEl.className = 'live-stats-value ' + (agg.profit > 0 ? 'live-stats-profit' : agg.profit < 0 ? 'live-stats-loss' : '');
      }
      if (wageredEl) wageredEl.textContent = formatDollars(agg.wagered);
      if (winsEl) {
        winsEl.textContent = String(agg.wins);
        winsEl.className = 'live-stats-value live-stats-wins';
      }
      if (lossesEl) {
        lossesEl.textContent = String(agg.losses);
        lossesEl.className = 'live-stats-value live-stats-losses';
      }

      this.renderGraph();
    },

    renderGraph() {
      const canvas = document.getElementById('liveStatsGraph');
      if (!canvas || history.length < 2) return;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight || 80;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      const profits = history.map((p) => p.profit);
      const minP = Math.min(...profits, 0);
      const maxP = Math.max(...profits, 0);
      const range = maxP - minP || 1;
      const pad = { top: 8, right: 8, bottom: 8, left: 8 };
      const gw = w - pad.left - pad.right;
      const gh = h - pad.top - pad.bottom;

      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, 0, w, h);

      const lastProfit = profits[profits.length - 1] || 0;
      ctx.strokeStyle = lastProfit >= 0 ? 'rgba(0, 212, 170, 0.5)' : 'rgba(255, 71, 87, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      history.forEach((p, i) => {
        const x = pad.left + (i / Math.max(1, history.length - 1)) * gw;
        const y = pad.top + gh - ((p.profit - minP) / range) * gh;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    const popup = document.getElementById('liveStatsPopup');
    if (!popup) return;

    const closeBtn = document.getElementById('liveStatsClose');
    const refreshBtn = document.getElementById('liveStatsRefresh');
    const gameSelect = document.getElementById('liveStatsGameSelect');
    const header = document.getElementById('liveStatsHeader');

    if (closeBtn) closeBtn.addEventListener('click', () => LiveStats.close());
    if (refreshBtn) refreshBtn.addEventListener('click', () => { LiveStats.refresh(); LiveStats.render(); });
    if (gameSelect) gameSelect.addEventListener('change', () => LiveStats.render());

    let dragX = 0, dragY = 0, startX = 0, startY = 0;
    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        dragX = popup.offsetLeft;
        dragY = popup.offsetTop;
        startX = e.clientX;
        startY = e.clientY;
        const onMove = (e2) => {
          popup.style.left = (dragX + e2.clientX - startX) + 'px';
          popup.style.top = (dragY + e2.clientY - startY) + 'px';
          popup.style.right = 'auto';
          popup.style.bottom = 'auto';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    document.querySelectorAll('.live-stats-trigger').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gameId = btn.getAttribute('data-game-id') || 'all';
        LiveStats.open(gameId);
      });
    });
  });
})();

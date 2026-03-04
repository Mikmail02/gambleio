/**
 * Mines: 5x5 grid, N mines (1-24). Click safe tiles to multiply. Hit mine = lose.
 * RTP 97%. P(nå s) = C(25-s,N)/C(25,N), Multiplier(s) = 0.97 / P(nå s).
 */
(function () {
  const GRID_SIZE = 25;
  const RTP = 0.97;

  function binom(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    let r = 1;
    for (let i = 0; i < k; i++) {
      r = r * (n - i) / (i + 1);
    }
    return r;
  }

  /** P(nå s) = C(25-s, N) / C(25, N) */
  function probReached(s, N) {
    if (s < 0 || s > 25 - N) return 0;
    return binom(25 - s, N) / binom(25, N);
  }

  /** Multiplier at step s (RTP-adjusted) */
  function getMultiplier(s, N) {
    const p = probReached(s, N);
    if (p <= 0) return 0;
    return RTP / p;
  }

  /** Precompute multipliers for all s for given N */
  function getMultipliersForMines(N) {
    const mults = [];
    for (let s = 0; s <= 25 - N; s++) {
      mults.push(getMultiplier(s, N));
    }
    return mults;
  }

  function getAuthHeaders() {
    if (typeof window.Auth !== 'undefined' && typeof window.Auth.getAuthHeaders === 'function') {
      return window.Auth.getAuthHeaders();
    }
    const token = typeof window.Auth !== 'undefined' && window.Auth.getToken ? window.Auth.getToken() : null;
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  let state = {
    mode: 'manual',
    mines: 3,
    bet: 10,
    roundId: null,
    revealed: [],
    safeClicks: 0,
    selectedTiles: [],
    autoRounds: 0,
    autoRunning: false,
    fastMode: false,
    multipliers: [],
  };

  const TILE_REVEAL_MS = 180;
  const AUTO_TILE_DELAY_MS = 120;
  const AUTO_ROUND_DELAY_MS = 900;
  const WIN_POPUP_DURATION_MS = 2500;

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  }

  function renderGrid(container, isAuto, selectedSet) {
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < GRID_SIZE; i++) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'mines-tile';
      tile.dataset.index = String(i);
      tile.setAttribute('aria-label', `Tile ${i + 1}`);
      if (isAuto && selectedSet && selectedSet.has(i)) {
        tile.classList.add('mines-tile-selected');
      }
      container.appendChild(tile);
    }
  }

  function updateUI() {
    const profitEl = document.getElementById('minesProfit');
    const betEl = document.getElementById('minesBetAmount');
    const minesSelect = document.getElementById('minesMines');
    const gemsEl = document.getElementById('minesGems');
    const multEl = document.getElementById('minesMultiplier');
    const betBtn = document.getElementById('minesBetBtn');
    const cashOutBtn = document.getElementById('minesCashOutBtn');
    const startAutoBtn = document.getElementById('minesStartAutoBtn');
    const modeManual = document.getElementById('minesModeManual');
    const modeAuto = document.getElementById('minesModeAuto');
    const autoRoundsInput = document.getElementById('minesAutoRounds');
    const autoGroup = document.getElementById('minesAutoGroup');
    const fastModeToggle = document.getElementById('minesFastMode');

    if (betEl) betEl.value = state.bet;
    if (minesSelect) minesSelect.value = state.mines;
    if (gemsEl) gemsEl.textContent = 25 - state.mines;
    if (modeManual) modeManual.classList.toggle('is-active', state.mode === 'manual');
    if (modeAuto) modeAuto.classList.toggle('is-active', state.mode === 'auto');
    if (autoGroup) autoGroup.classList.toggle('hidden', state.mode !== 'auto');
    if (fastModeToggle) {
      fastModeToggle.classList.toggle('is-on', state.fastMode);
      fastModeToggle.setAttribute('aria-checked', state.fastMode);
    }
    if (autoRoundsInput) autoRoundsInput.value = state.autoRounds || '';

    const inRound = state.roundId != null;
    const balance = window.Game && (typeof window.Game.getBalance === 'function' ? window.Game.getBalance() : window.Game.balance);
    const canBet = !inRound && state.bet >= 0.01 && (window.Game ? state.bet <= (balance || 0) : true);

    if (betBtn) {
      betBtn.disabled = !canBet;
      betBtn.textContent = inRound ? '—' : 'Bet';
      betBtn.classList.toggle('hidden', state.mode === 'auto');
    }
    if (cashOutBtn) {
      cashOutBtn.disabled = !inRound || state.safeClicks === 0;
      cashOutBtn.classList.toggle('hidden', state.mode !== 'manual' || !inRound);
    }
    if (startAutoBtn) {
      const canStartAuto = state.mode === 'auto' && state.selectedTiles.length > 0 && state.selectedTiles.length <= 25 - state.mines;
      startAutoBtn.disabled = !state.autoRunning && !canStartAuto;
      startAutoBtn.textContent = state.autoRunning ? 'Stop' : 'Start Autobet';
      startAutoBtn.classList.toggle('hidden', state.mode !== 'auto');
    }

    if (inRound && state.multipliers[state.safeClicks] != null) {
      if (multEl) multEl.textContent = state.multipliers[state.safeClicks].toFixed(2) + '×';
      const winAmount = state.bet * state.multipliers[state.safeClicks];
      if (profitEl) profitEl.textContent = formatDollars(winAmount - state.bet);
    } else {
      if (multEl) multEl.textContent = '—';
      if (profitEl && !inRound) profitEl.textContent = formatDollars(0);
    }

    const potentialEl = document.getElementById('minesPotentialValue');
    if (potentialEl && state.mode === 'auto' && state.selectedTiles.length > 0) {
      const mults = getMultipliersForMines(state.mines);
      const s = state.selectedTiles.length;
      const mult = mults[s];
      const winAmt = state.bet * (mult || 0);
      potentialEl.textContent = mult != null ? `${mult.toFixed(2)}× → ${formatDollars(winAmt)}` : '—';
    } else if (potentialEl && state.mode === 'auto') {
      potentialEl.textContent = '—';
    }
  }

  function showWinPopup(multiplier, winAmount) {
    const popup = document.getElementById('minesWinPopup');
    const multEl = document.getElementById('minesWinPopupMult');
    const amountEl = document.getElementById('minesWinPopupAmount');
    if (!popup || !multEl || !amountEl) return;
    multEl.textContent = multiplier.toFixed(2) + '×';
    amountEl.textContent = formatDollars(winAmount);
    popup.classList.remove('hidden');
    setTimeout(() => popup.classList.add('hidden'), WIN_POPUP_DURATION_MS);
  }

  function revealTile(index, isMine, multiplier) {
    const grid = document.getElementById('minesGrid');
    if (!grid) return;
    const tile = grid.querySelector(`[data-index="${index}"]`);
    if (!tile) return;
    tile.disabled = true;
    tile.classList.remove('mines-tile-selected');
    if (isMine) {
      tile.classList.add('mines-tile-mine');
      tile.innerHTML = '💣';
    } else {
      tile.classList.add('mines-tile-gem');
      tile.innerHTML = '💎';
    }
  }

  async function revealTileWithAnimation(index, isMine, multiplier, fast) {
    const grid = document.getElementById('minesGrid');
    if (!grid) return;
    const tile = grid.querySelector(`[data-index="${index}"]`);
    if (!tile) return;
    tile.disabled = true;
    tile.classList.remove('mines-tile-selected');
    tile.classList.add('mines-tile-revealing');
    await new Promise(r => setTimeout(r, fast ? 20 : TILE_REVEAL_MS));
    tile.classList.remove('mines-tile-revealing');
    if (isMine) {
      tile.classList.add('mines-tile-mine');
      tile.innerHTML = '💣';
    } else {
      tile.classList.add('mines-tile-gem');
      tile.innerHTML = '💎';
    }
  }

  async function placeBet() {
    if (state.roundId != null) return;
    const bet = parseFloat(document.getElementById('minesBetAmount')?.value) || state.bet;
    const mines = parseInt(document.getElementById('minesMines')?.value, 10) || 3;
    if (!Number.isFinite(bet) || bet < 0.01) return;
    if (!Number.isFinite(mines) || mines < 1 || mines > 24) return;
    const balance = window.Game && (typeof window.Game.getBalance === 'function' ? window.Game.getBalance() : window.Game.balance);
    if (window.Game && bet > (balance || 0)) return;

    try {
      const res = await fetch('/api/mines/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ amount: bet, mines }),
      });
      const data = res.ok ? await res.json() : await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'GAMBLE_LOCKED' && data.error && window.showGambleLockToast) {
          window.showGambleLockToast(data.error);
          state.autoRunning = false;
          updateUI();
        } else {
          alert(data.error || 'Bet failed');
        }
        return;
      }
      state.bet = bet;
      state.mines = mines;
      state.roundId = data.roundId;
      state.revealed = [];
      state.safeClicks = 0;
      state.multipliers = getMultipliersForMines(mines);
      if (window.Game) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      renderGrid(document.getElementById('minesGrid'), state.mode === 'auto', new Set(state.selectedTiles));
      updateUI();
    } catch (e) {
      alert('Bet failed');
    }
  }

  async function reveal(index) {
    if (state.roundId == null) return;
    if (state.revealed.includes(index)) return;

    try {
      const res = await fetch('/api/mines/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ roundId: state.roundId, tileIndex: index }),
      });
      const data = res.ok ? await res.json() : await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Reveal failed');
        return;
      }
      state.revealed.push(index);
      const fast = state.fastMode;
      await revealTileWithAnimation(index, data.isMine, data.multiplier, fast);
      if (data.isMine) {
        if (window.LiveStats) window.LiveStats.recordRound('mines', state.bet, 0);
        state.roundId = null;
        if (window.Game) window.Game.balance = data.balance;
        if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
        updateUI();
        return;
      }
      state.safeClicks = data.safeClicks;
      if (window.Game) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      updateUI();
    } catch (e) {
      alert('Reveal failed');
    }
  }

  async function cashOut(fromAutobet) {
    if (state.roundId == null || state.safeClicks === 0) return;
    try {
      const res = await fetch('/api/mines/cash-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ roundId: state.roundId }),
      });
      const data = res.ok ? await res.json() : await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Cash out failed');
        return;
      }
      state.roundId = null;
      if (window.Game) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      if (window.Stats && window.Stats.win) {
        await window.Stats.win(data.winAmount, data.multiplier, state.bet, 'mines');
      }
      if (window.LiveStats) window.LiveStats.recordRound('mines', state.bet, data.winAmount);
      if (fromAutobet && state.autoRunning) {
        state.autoRunning = false;
        showWinPopup(data.multiplier, data.winAmount);
      }
      updateUI();
      renderGrid(document.getElementById('minesGrid'), state.mode === 'auto', new Set(state.selectedTiles));
    } catch (e) {
      alert('Cash out failed');
    }
  }

  function canAffordBet() {
    const bet = parseFloat(document.getElementById('minesBetAmount')?.value) || state.bet;
    const balance = window.Game && (typeof window.Game.getBalance === 'function' ? window.Game.getBalance() : window.Game.balance);
    return Number.isFinite(bet) && bet >= 0.01 && window.Game && bet <= (balance || 0);
  }

  async function runAutoRound() {
    if (!state.autoRunning || state.roundId != null) return;
    if (!canAffordBet()) {
      state.autoRunning = false;
      updateUI();
      return;
    }
    await placeBet();
    if (state.roundId == null) return;
    const order = [...state.selectedTiles].sort((a, b) => a - b);
    const fast = state.fastMode;
    if (fast) {
      const results = [];
      for (const idx of order) {
        if (!state.autoRunning || state.roundId == null) break;
        const r = await revealForFastMode(idx);
        if (!r) break;
        results.push(r);
        if (r.isMine) break;
      }
      if (results.length > 0) {
        for (const r of results) {
          revealTile(r.index, r.isMine, r.multiplier);
        }
      }
    } else {
      for (const idx of order) {
        if (!state.autoRunning || state.roundId == null) break;
        await reveal(idx);
        if (state.roundId == null) break;
      }
    }
    if (state.roundId != null) {
      await cashOut(true);
    }
    updateUI();
    if (state.autoRunning) {
      await new Promise(r => setTimeout(r, AUTO_ROUND_DELAY_MS));
    }
  }

  async function revealForFastMode(index) {
    if (state.roundId == null || state.revealed.includes(index)) return null;
    try {
      const res = await fetch('/api/mines/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ roundId: state.roundId, tileIndex: index }),
      });
      const data = res.ok ? await res.json() : await res.json().catch(() => ({}));
      if (!res.ok) return null;
      state.revealed.push(index);
      if (data.isMine) {
        if (window.LiveStats) window.LiveStats.recordRound('mines', state.bet, 0);
        state.roundId = null;
        if (window.Game) window.Game.balance = data.balance;
        if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
        return { index, isMine: true, multiplier: 0 };
      }
      state.safeClicks = data.safeClicks;
      if (window.Game) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      return { index, isMine: false, multiplier: data.multiplier };
    } catch (e) {
      return null;
    }
  }

  async function runAutoLoop() {
    const maxRounds = parseInt(document.getElementById('minesAutoRounds')?.value, 10);
    let rounds = 0;
    while (state.autoRunning) {
      if (!canAffordBet()) {
        state.autoRunning = false;
        updateUI();
        break;
      }
      await runAutoRound();
      rounds++;
      if (Number.isFinite(maxRounds) && maxRounds > 0 && rounds >= maxRounds) break;
    }
  }

  function onShow() {
    state.mode = document.getElementById('minesModeAuto')?.classList.contains('is-active') ? 'auto' : 'manual';
    const fm = document.getElementById('minesFastMode');
    state.fastMode = fm?.classList.contains('is-on') || false;
    renderGrid(document.getElementById('minesGrid'), state.mode === 'auto', new Set(state.selectedTiles));
    updateUI();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-mines');
    if (!page) return;

    const grid = document.getElementById('minesGrid');
    const betBtn = document.getElementById('minesBetBtn');
    const cashOutBtn = document.getElementById('minesCashOutBtn');
    const startAutoBtn = document.getElementById('minesStartAutoBtn');
    const modeManual = document.getElementById('minesModeManual');
    const modeAuto = document.getElementById('minesModeAuto');
    const betInput = document.getElementById('minesBetAmount');
    const minesSelect = document.getElementById('minesMines');
    const halfBtn = document.getElementById('minesBetHalf');
    const doubleBtn = document.getElementById('minesBetDouble');
    const fastModeToggle = document.getElementById('minesFastMode');

    renderGrid(grid, false, null);

    if (grid) {
      grid.addEventListener('click', (e) => {
        const tile = e.target.closest('.mines-tile');
        if (!tile || tile.disabled) return;
        const idx = parseInt(tile.dataset.index, 10);
        if (state.mode === 'manual') {
          if (state.roundId != null) {
            reveal(idx);
          }
        } else {
          if (state.roundId == null) {
            if (state.selectedTiles.includes(idx)) {
              state.selectedTiles = state.selectedTiles.filter(i => i !== idx);
            } else if (state.selectedTiles.length < 25 - state.mines) {
              state.selectedTiles.push(idx);
              state.selectedTiles.sort((a, b) => a - b);
            }
            tile.classList.toggle('mines-tile-selected', state.selectedTiles.includes(idx));
            updateUI();
          }
        }
      });
    }

    if (betBtn) betBtn.addEventListener('click', placeBet);
    if (cashOutBtn) cashOutBtn.addEventListener('click', cashOut);

    if (startAutoBtn) {
      startAutoBtn.addEventListener('click', () => {
        if (state.autoRunning) {
          state.autoRunning = false;
          updateUI();
          return;
        }
        if (state.mode !== 'auto' || !state.selectedTiles.length) return;
        state.autoRunning = true;
        updateUI();
        runAutoLoop();
      });
    }

    if (modeManual) modeManual.addEventListener('click', () => {
      state.mode = 'manual';
      state.selectedTiles = [];
      renderGrid(grid, false, null);
      updateUI();
    });
    if (modeAuto) modeAuto.addEventListener('click', () => {
      state.mode = 'auto';
      renderGrid(grid, true, new Set(state.selectedTiles));
      updateUI();
    });

    if (betInput) {
      betInput.addEventListener('input', () => {
        const v = parseFloat(betInput.value);
        if (Number.isFinite(v) && v >= 0) state.bet = v;
        updateUI();
      });
    }
    if (minesSelect) {
      minesSelect.addEventListener('change', () => {
        state.mines = parseInt(minesSelect.value, 10) || 3;
        if (state.selectedTiles.length > 25 - state.mines) {
          state.selectedTiles = state.selectedTiles.slice(0, 25 - state.mines);
        }
        updateUI();
      });
    }
    if (halfBtn) halfBtn.addEventListener('click', () => {
      state.bet = Math.max(0.01, (state.bet || 10) / 2);
      if (betInput) betInput.value = state.bet;
      updateUI();
    });
    if (doubleBtn) doubleBtn.addEventListener('click', () => {
      state.bet = (state.bet || 10) * 2;
      if (betInput) betInput.value = state.bet;
      updateUI();
    });
    if (fastModeToggle) fastModeToggle.addEventListener('click', () => {
      state.fastMode = !state.fastMode;
      fastModeToggle.classList.toggle('is-on', state.fastMode);
      fastModeToggle.setAttribute('aria-checked', state.fastMode);
      updateUI();
    });
  });

  window.Mines = {
    onShow,
    getMultiplier: (s, N) => getMultiplier(s, N),
    getMultipliersForMines,
  };
})();

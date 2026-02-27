/**
 * Roulette: CS:GO-style slider, 20s shared rounds, winner feed.
 * Uses server API for round sync.
 */
(function () {
  const CHIP_VALUES = [1, 5, 25, 100, 500, 5000, 50000];
  const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const API = '/api';

  function isRed(n) { return RED_NUMBERS.includes(n); }

  const chipsContainer = document.getElementById('rouletteChips');
  const gridEl = document.getElementById('rouletteGrid');
  const totalBetEl = document.getElementById('rouletteTotalBet');
  const clearBetsBtn = document.getElementById('rouletteClearBets');
  const redoBtn = document.getElementById('rouletteRedo');
  const doubleBtn = document.getElementById('roulette2x');
  const phaseEl = document.getElementById('roulettePhaseText');
  const timerEl = document.getElementById('rouletteTimer');
  const progressFill = document.getElementById('rouletteProgressFill');
  const sliderStrip = document.getElementById('csgoSliderStrip');
  const resultDisplay = document.getElementById('rouletteResultDisplay');
  const winnerFeedList = document.getElementById('winnerFeedList');

  let selectedChipValue = CHIP_VALUES[0];
  let localBets = {};
  let lastBets = null;
  let balanceUpdateCallback = null;
  let pollInterval = null;
  let lastRoundId = 0;
  let animatedRoundId = 0;

  function getBetMultiplier(key) {
    if (key === '1-12' || key === '13-24' || key === '25-36') return 3;
    if (key === 'red' || key === 'black' || key === 'odd' || key === 'even' || key === '1-18' || key === '19-36') return 2;
    const num = parseInt(key, 10);
    if (!isNaN(num) && num >= 0 && num <= 36) return 36;
    return 2;
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  }

  function getTotalBet() {
    return Object.values(localBets).reduce((s, v) => s + v, 0);
  }

  function getAuthHeaders() {
    const token = localStorage.getItem('gambleio_token');
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  async function fetchRound() {
    try {
      const res = await fetch(API + '/roulette/round', { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function placeBetApi(key, amount) {
    try {
      const res = await fetch(API + '/roulette/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ key, amount }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      Game.balance = data.balance;
      return data;
    } catch (e) {
      return null;
    }
  }

  async function clearBetsApi() {
    try {
      const res = await fetch(API + '/roulette/clear-bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const data = await res.json();
      Game.balance = data.balance;
      return data;
    } catch (e) {
      return null;
    }
  }

  function buildSliderStrip() {
    if (!sliderStrip) return;
    const cells = [];
    for (let i = 0; i < 120; i++) {
      const num = WHEEL_ORDER[i % 37];
      const cls = num === 0 ? 'csgo-slider-cell--green' : isRed(num) ? 'csgo-slider-cell--red' : 'csgo-slider-cell--black';
      cells.push(`<div class="csgo-slider-cell ${cls}" data-num="${num}">${num}</div>`);
    }
    sliderStrip.innerHTML = cells.join('');
    const vw = sliderStrip.parentElement?.offsetWidth || 600;
    sliderStrip.style.transform = `translateX(${vw / 2 - 31}px)`;
  }

  function animateSliderToWinner(winNumber, durationMs) {
    if (!sliderStrip) return Promise.resolve();
    const cells = sliderStrip.querySelectorAll('.csgo-slider-cell');
    if (!cells.length) return Promise.resolve();
    const cellWidth = 63;
    const viewportWidth = sliderStrip.parentElement?.offsetWidth || 600;
    const centerOffset = viewportWidth / 2 - cellWidth / 2;
    let targetIdx = 0;
    for (let i = 0; i < cells.length; i++) {
      if (parseInt(cells[i].dataset.num, 10) === winNumber) {
        targetIdx = i;
        break;
      }
    }
    const wiggle = (Math.random() - 0.5) * 150;
    const targetX = centerOffset - targetIdx * cellWidth + wiggle;
    const startX = parseFloat(sliderStrip.style.transform?.replace(/translateX\(([^)]+)\)/, '$1')) || 0;
    const distance = Math.abs(targetX - startX);
    const duration = durationMs || 3000 + Math.random() * 2000;
    const startTime = performance.now();

    return new Promise((resolve) => {
      function tick(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3.5);
        const x = startX + (targetX - startX) * ease;
        sliderStrip.style.transform = `translateX(${x}px)`;
        cells.forEach((c) => c.classList.remove('csgo-slider-cell--winner'));
        const centerCell = Math.round((-x + centerOffset) / cellWidth);
        if (cells[centerCell]) cells[centerCell].classList.add('csgo-slider-cell--winner');
        if (t < 1) requestAnimationFrame(tick);
        else {
          const winnerCell = sliderStrip.querySelector(`[data-num="${winNumber}"]`);
          if (winnerCell) winnerCell.classList.add('csgo-slider-cell--winner');
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }

  function updateUIFromRound(data) {
    if (!data) return;
    if (phaseEl) phaseEl.textContent = data.phase === 'betting' ? 'Place Your Bets' : data.phase === 'spinning' ? 'Spinning...' : 'Result';
    const now = data.serverTime || Date.now();
    const remaining = Math.max(0, Math.ceil((data.phaseEndTime - now) / 1000));
    if (timerEl) timerEl.textContent = remaining + 's';
    const totalPhase = data.phase === 'betting' ? 20000 : data.phase === 'spinning' ? 5000 : 3000;
    const elapsed = totalPhase - remaining * 1000;
    const pct = Math.min(100, (elapsed / totalPhase) * 100);
    if (progressFill) progressFill.style.width = pct + '%';

    if (data.phase === 'spinning' || data.phase === 'result') {
      if (gridEl) gridEl.classList.add('disabled');
      if (data.winNumber !== null && data.winNumber !== undefined && animatedRoundId !== data.roundId) {
        animatedRoundId = data.roundId;
        animateSliderToWinner(data.winNumber, 4500);
      }
      if (data.phase === 'result' && data.winNumber !== null) {
        const color = data.winNumber === 0 ? 'green' : isRed(data.winNumber) ? 'red' : 'black';
        if (resultDisplay) {
          resultDisplay.textContent = `Winner: ${data.winNumber} (${color})`;
          resultDisplay.classList.add('win');
        }
      }
    } else {
      if (gridEl) gridEl.classList.remove('disabled');
      if (resultDisplay) {
        resultDisplay.textContent = '';
        resultDisplay.classList.remove('win');
      }
    }

    if (data.balance !== undefined) Game.balance = data.balance;
    if (data.myBets && data.myBets.length) {
      localBets = {};
      data.myBets.forEach((b) => {
        localBets[b.key] = (localBets[b.key] || 0) + b.amount;
      });
    } else if (data.phase === 'betting') {
      if (data.roundId !== lastRoundId) {
        lastRoundId = data.roundId;
        localBets = {};
      }
    } else if (data.phase === 'spinning' && Object.keys(localBets).length) {
      lastBets = JSON.parse(JSON.stringify(localBets));
    }
    updateBetDisplay();
    if (balanceUpdateCallback) balanceUpdateCallback();
  }

  async function onGridClick(cell) {
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    const key = cell.getAttribute('data-bet');
    if (!key) return;
    if (!Game.canBet(selectedChipValue)) {
      showPopup('Not enough balance');
      return;
    }
    const result = await placeBetApi(key, selectedChipValue);
    if (!result) {
      showPopup('Bet failed');
      return;
    }
    localBets[key] = (localBets[key] || 0) + selectedChipValue;
    if (balanceUpdateCallback) balanceUpdateCallback();
    updateBetDisplay();
  }

  async function clearBets() {
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    const result = await clearBetsApi();
    if (!result) {
      showPopup('Clear failed');
      return;
    }
    localBets = {};
    updateBetDisplay();
    if (balanceUpdateCallback) balanceUpdateCallback();
  }

  async function redoLastBet() {
    if (!lastBets || !Object.keys(lastBets).length) return;
    for (const [key, amount] of Object.entries(lastBets)) {
      if (Game.canBet(amount)) {
        await placeBetApi(key, amount);
        localBets[key] = (localBets[key] || 0) + amount;
      }
    }
    const data = await fetchRound();
    if (data && data.balance !== undefined) Game.balance = data.balance;
    updateBetDisplay();
    if (balanceUpdateCallback) balanceUpdateCallback();
  }

  async function doubleLastBet() {
    if (!lastBets || !Object.keys(lastBets).length) return;
    const template = {};
    for (const [key, amount] of Object.entries(lastBets)) {
      template[key] = amount * 2;
    }
    const total = Object.values(template).reduce((s, v) => s + v, 0);
    if (!Game.canBet(total)) {
      showPopup('Not enough balance');
      return;
    }
    for (const [key, amount] of Object.entries(template)) {
      await placeBetApi(key, amount);
      localBets[key] = (localBets[key] || 0) + amount;
    }
    const data = await fetchRound();
    if (data && data.balance !== undefined) Game.balance = data.balance;
    updateBetDisplay();
    if (balanceUpdateCallback) balanceUpdateCallback();
  }

  function showPopup(msg) {
    const el = document.getElementById('rouletteBalancePopup');
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 2500);
    }
  }

  function updateBetDisplay() {
    if (totalBetEl) totalBetEl.textContent = formatDollars(getTotalBet());
    if (!gridEl) return;
    gridEl.querySelectorAll('.roulette-cell').forEach((el) => {
      const key = el.getAttribute('data-bet');
      const amount = localBets[key] || 0;
      const existing = el.querySelector('.roulette-chip-stack');
      if (existing) existing.remove();
      if (amount > 0) {
        const stack = document.createElement('div');
        stack.className = 'roulette-chip-stack';
        stack.textContent = formatDollars(amount);
        el.appendChild(stack);
      }
    });
  }

  function renderChips() {
    if (!chipsContainer) return;
    chipsContainer.innerHTML = CHIP_VALUES.map((v) => {
      const sel = v === selectedChipValue;
      return `<button type="button" class="chip chip-${v} ${sel ? 'chip-selected' : ''}" data-value="${v}" title="$${v}"><span>${v}</span></button>`;
    }).join('');
    chipsContainer.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedChipValue = Number(btn.getAttribute('data-value'));
        renderChips();
      });
    });
  }

  function buildGrid() {
    if (!gridEl) return;
    const parts = [];
    parts.push(`<div class="roulette-zero-row"><div class="roulette-cell roulette-cell-0" data-bet="0" data-mult="${getBetMultiplier('0')}"><span class="roulette-cell-label">0</span></div></div>`);
    for (let row = 0; row < 3; row++) {
      const cells = [];
      for (let col = 0; col < 12; col++) {
        const n = 1 + row * 12 + col;
        const color = isRed(n) ? 'red' : 'black';
        cells.push(`<div class="roulette-cell roulette-cell-num roulette-${color}" data-bet="${n}" data-mult="${getBetMultiplier(String(n))}"><span class="roulette-cell-label">${n}</span></div>`);
      }
      parts.push(`<div class="roulette-row">${cells.join('')}</div>`);
    }
    const outside = [
      { key: '1-12', label: '1st 12' }, { key: '13-24', label: '2nd 12' }, { key: '25-36', label: '3rd 12' },
      { key: 'red', label: 'Red', class: 'roulette-red' }, { key: 'black', label: 'Black', class: 'roulette-black' },
      { key: '1-18', label: '1-18' }, { key: '19-36', label: '19-36' }, { key: 'odd', label: 'Odd' }, { key: 'even', label: 'Even' },
    ];
    parts.push(`<div class="roulette-outside">${outside.map((o) => `<div class="roulette-cell roulette-cell-outside ${o.class || ''}" data-bet="${o.key}" data-mult="${getBetMultiplier(o.key)}"><span class="roulette-cell-label">${o.label}</span></div>`).join('')}</div>`);
    gridEl.innerHTML = parts.join('');
    gridEl.querySelectorAll('.roulette-cell').forEach((el) => {
      el.addEventListener('click', () => onGridClick(el));
    });
  }

  async function loadWinners() {
    try {
      const res = await fetch(API + '/roulette/winners');
      if (!res.ok) return;
      const winners = await res.json();
      if (!winnerFeedList) return;
      winnerFeedList.innerHTML = winners.slice(0, 10).map((w) =>
        `<div class="winner-feed-entry"><span class="winner-name">${escapeHtml(w.username)}</span> won <span class="winner-amount">${formatDollars(w.amount)}</span> on ${w.number}</div>`
      ).join('');
    } catch (e) {}
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  async function poll() {
    const data = await fetchRound();
    updateUIFromRound(data);
    await loadWinners();
  }

  function init() {
    buildSliderStrip();
    renderChips();
    buildGrid();
    updateBetDisplay();
    if (clearBetsBtn) clearBetsBtn.addEventListener('click', clearBets);
    if (redoBtn) redoBtn.addEventListener('click', redoLastBet);
    if (doubleBtn) doubleBtn.addEventListener('click', doubleLastBet);
    poll();
    pollInterval = setInterval(poll, 1500);
  }

  function onShow() {
    buildSliderStrip();
    poll();
  }

  function setBalanceUpdateCallback(fn) {
    balanceUpdateCallback = fn;
  }

  window.Roulette = {
    init,
    setBalanceUpdateCallback,
    updateBetDisplay: () => updateBetDisplay(),
    updateSpinButton: () => {},
    getTotalBet,
    onShow,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

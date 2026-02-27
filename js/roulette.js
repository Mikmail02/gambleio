/**
 * Roulette: European wheel (0–36), chip betting, spinning wheel + ball animation.
 * Outcome is purely random; animation is deterministic from chosen result.
 */
(function () {
  const CHIP_VALUES = [1, 5, 25, 100, 500, 5000, 50000];
  // European wheel order (clockwise from 0 at a reference position)
  const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

  function isRed(n) {
    return RED_NUMBERS.includes(n);
  }

  const canvas = document.getElementById('rouletteWheelCanvas');
  const wheelContainer = document.getElementById('rouletteWheel');
  const spinBtn = document.getElementById('rouletteSpin');
  const resultEl = document.getElementById('rouletteResult');
  const chipsContainer = document.getElementById('rouletteChips');
  const gridEl = document.getElementById('rouletteGrid');
  const totalBetEl = document.getElementById('rouletteTotalBet');
  const clearBetsBtn = document.getElementById('rouletteClearBets');
  const redoBtn = document.getElementById('rouletteRedo');
  const doubleBtn = document.getElementById('roulette2x');

  let selectedChipValue = CHIP_VALUES[0];
  let bets = {}; // e.g. { "15": 1500, "red": 500 }
  let lastBets = null; // copy of bets before last spin (for redo / 2x)
  let lastWinNumber = null; // highlight winning segment/cell until next spin
  let lastWheelRotation = 0;
  let isSpinning = false;
  let balanceUpdateCallback = null;

  function getBetMultiplier(key) {
    // Returns total return multiplier (including stake): if you bet $100 and win, you get back $mult * $100 total
    // Check specific string keys FIRST before parsing as number
    // Dozens: 3× (2:1 odds = 2x win + 1x stake = 3x total)
    if (key === '1-12' || key === '13-24' || key === '25-36') return 3;
    // Red/Black: 2× (1:1 odds = 1x win + 1x stake = 2x total)
    if (key === 'red' || key === 'black') return 2;
    // Other outside bets (odd, even, 1-18, 19-36): 2×
    if (key === 'odd' || key === 'even' || key === '1-18' || key === '19-36') return 2;
    // All individual numbers (0-36): 36× (35:1 odds = 35x win + 1x stake = 36x total)
    const num = parseInt(key, 10);
    if (!isNaN(num) && num >= 0 && num <= 36) return 36;
    // Default fallback
    return 2;
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  }

  function getTotalBet() {
    return Object.values(bets).reduce((s, v) => s + v, 0);
  }

  async function placeBet(key, amount) {
    if (!Game.canBet(amount)) return false;
    const placeResult = window.Stats && window.Stats.placeBet
      ? await window.Stats.placeBet(amount)
      : (Game.placeBet(amount) ? { balance: Game.balance } : null);
    if (!placeResult) return false;
    bets[key] = (bets[key] || 0) + amount;
    return true;
  }

  function renderChips() {
    if (!chipsContainer) return;
    chipsContainer.innerHTML = CHIP_VALUES.map((value) => {
      const selected = value === selectedChipValue;
      return `<button type="button" class="chip chip-${value} ${selected ? 'chip-selected' : ''}" data-value="${value}" title="$${value}"><span>${value}</span></button>`;
    }).join('');
    chipsContainer.querySelectorAll('.chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedChipValue = Number(btn.getAttribute('data-value'));
        renderChips();
      });
    });
  }

  // Betting grid: large green 0 on top, then 1–36 horizontal (3 rows × 12 cols), then outside bets; multiplier shown on hover
  function buildGrid() {
    if (!gridEl) return;
    const parts = [];
    parts.push(`<div class="roulette-zero-row"><div class="roulette-cell roulette-cell-0" data-bet="0" data-mult="${getBetMultiplier('0')}"><span class="roulette-cell-label">0</span></div></div>`);
    const numRows = [];
    for (let row = 0; row < 3; row++) {
      const cells = [];
      for (let col = 0; col < 12; col++) {
        const n = 1 + row * 12 + col;
        const color = isRed(n) ? 'red' : 'black';
        cells.push(`<div class="roulette-cell roulette-cell-num roulette-${color}" data-bet="${n}" data-mult="${getBetMultiplier(String(n))}"><span class="roulette-cell-label">${n}</span></div>`);
      }
      numRows.push(`<div class="roulette-row">${cells.join('')}</div>`);
    }
    parts.push(`<div class="roulette-numbers-block">${numRows.join('')}</div>`);
    const outside = [
      { key: '1-12', label: '1st 12' },
      { key: '13-24', label: '2nd 12' },
      { key: '25-36', label: '3rd 12' },
      { key: 'red', label: 'Red', class: 'roulette-red' },
      { key: 'black', label: 'Black', class: 'roulette-black' },
      { key: '1-18', label: '1-18' },
      { key: '19-36', label: '19-36' },
      { key: 'odd', label: 'Odd' },
      { key: 'even', label: 'Even' },
    ];
    parts.push(`<div class="roulette-outside">${outside.map((o) => `<div class="roulette-cell roulette-cell-outside ${o.class || ''}" data-bet="${o.key}" data-mult="${getBetMultiplier(o.key)}"><span class="roulette-cell-label">${o.label}</span></div>`).join('')}</div>`);
    gridEl.innerHTML = parts.join('');
    gridEl.querySelectorAll('.roulette-cell').forEach((el) => {
      el.addEventListener('click', () => onGridClick(el));
      setupCellHover(el);
    });
    updateWinnerHighlight();
  }

  function setupCellHover(cell) {
    let tooltip = null;
    const mult = cell.getAttribute('data-mult');
    if (!mult) return;
    
    cell.addEventListener('mouseenter', () => {
      if (tooltip) return;
      tooltip = document.createElement('div');
      tooltip.className = 'roulette-mult-tooltip';
      tooltip.textContent = `${mult}×`;
      const rect = cell.getBoundingClientRect();
      const gridRect = gridEl.getBoundingClientRect();
      tooltip.style.position = 'absolute';
      tooltip.style.left = `${rect.left - gridRect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top - gridRect.top - 32}px`;
      gridEl.appendChild(tooltip);
    });
    
    cell.addEventListener('mouseleave', () => {
      if (tooltip && tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
      tooltip = null;
    });
  }

  async function onGridClick(cell) {
    if (isSpinning) return;
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    const key = cell.getAttribute('data-bet');
    if (!key) return;
    if (!Game.canBet(selectedChipValue)) return;
    if (!(await placeBet(key, selectedChipValue))) return;
    if (balanceUpdateCallback) balanceUpdateCallback();
    updateBetDisplay();
    updateSpinButton();
  }

  function updateBetDisplay() {
    if (totalBetEl) totalBetEl.textContent = formatDollars(getTotalBet());
    if (!gridEl) return;
    gridEl.querySelectorAll('.roulette-cell').forEach((el) => {
      const key = el.getAttribute('data-bet');
      const amount = bets[key] || 0;
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

  function updateWinnerHighlight() {
    if (!gridEl) return;
    gridEl.querySelectorAll('.roulette-cell-winner').forEach((el) => el.classList.remove('roulette-cell-winner'));
    if (lastWinNumber !== null) {
      const cell = gridEl.querySelector(`.roulette-cell[data-bet="${lastWinNumber}"]`);
      if (cell) cell.classList.add('roulette-cell-winner');
    }
  }

  function updateSpinButton() {
    if (spinBtn) {
      const total = getTotalBet();
      spinBtn.disabled = isSpinning || total <= 0;
    }
    if (redoBtn) redoBtn.disabled = isSpinning || !lastBets || Object.keys(lastBets).length === 0;
    if (doubleBtn) doubleBtn.disabled = isSpinning || !lastBets || Object.keys(lastBets).length === 0;
  }

  async function clearBets() {
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    if (isSpinning) return;
    const total = getTotalBet();
    if (total > 0) {
      // Refund — not a win, just return money to balance
      if (window.Stats && window.Stats.refund) {
        await window.Stats.refund(total);
      } else {
        Game.balance += total;
      }
      if (balanceUpdateCallback) balanceUpdateCallback();
    }
    bets = {};
    updateBetDisplay();
    updateSpinButton();
  }

  function showNotEnoughBalance() {
    const el = document.getElementById('rouletteBalancePopup');
    if (el) {
      el.classList.remove('hidden');
      clearTimeout(window._roulettePopupTimer);
      window._roulettePopupTimer = setTimeout(() => el.classList.add('hidden'), 2500);
    }
  }

  async function applyBetsFromTemplate(template, multiplier) {
    const mult = multiplier || 1;
    const total = Object.values(template).reduce((s, v) => s + v * mult, 0);
    if (total <= 0) return false;
    if (!Game.canBet(total)) {
      showNotEnoughBalance();
      return false;
    }
    for (const [key, amount] of Object.entries(template)) {
      const amt = Math.round(amount * mult);
      if (amt > 0 && !(await placeBet(key, amt))) {
        showNotEnoughBalance();
        return false;
      }
    }
    return true;
  }

  async function redoLastBet() {
    if (isSpinning || !lastBets || Object.keys(lastBets).length === 0) return;
    if (!(await applyBetsFromTemplate(lastBets, 1))) return;
    if (balanceUpdateCallback) balanceUpdateCallback();
    updateBetDisplay();
    updateSpinButton();
  }

  async function doubleLastBet() {
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    if (isSpinning || !lastBets || Object.keys(lastBets).length === 0) return;
    if (!(await applyBetsFromTemplate(lastBets, 2))) return;
    if (balanceUpdateCallback) balanceUpdateCallback();
    updateBetDisplay();
    updateSpinButton();
  }

  // --- Wheel drawing ---
  let wheelCtx = null;
  const SEGMENTS = 37;
  const SEG_ANGLE = (2 * Math.PI) / SEGMENTS;

  function drawWheel(rotationRad) {
    if (!canvas || !wheelContainer) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wheelContainer.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    }
    if (!wheelCtx) wheelCtx = canvas.getContext('2d');
    const ctx = wheelCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 4;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);
    ctx.translate(-cx, -cy);
    for (let i = 0; i < SEGMENTS; i++) {
      const start = (i - 0.5) * SEG_ANGLE - Math.PI / 2;
      const end = start + SEG_ANGLE;
      const num = WHEEL_ORDER[i];
      let fill = '#1a472a';
      if (num !== 0) fill = isRed(num) ? '#c0392b' : '#1c1c1c';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
      const mid = (start + end) / 2;
      const tx = cx + (r * 0.7) * Math.cos(mid);
      const ty = cy + (r * 0.7) * Math.sin(mid);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.max(10, size / 28) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(-rotationRad);
      ctx.fillText(String(num), 0, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Stop arrow is at 3 o'clock (right). Wheel rotates so winning segment ends at the arrow.
  function getWinnerSegmentIndex(winNumber) {
    return WHEEL_ORDER.indexOf(winNumber);
  }

  function animateSpin(winNumber, durationMs) {
    return new Promise((resolve) => {
      const winnerSeg = getWinnerSegmentIndex(winNumber);
      const segCenterInWheel = winnerSeg * SEG_ANGLE - Math.PI / 2;
      const fullRotations = 4 + Math.floor(Math.random() * 5);
      const finalWheelRotation = 2 * Math.PI * fullRotations + (0 - segCenterInWheel);
      const startTime = performance.now();
      let finalRot = 0;

      function tick(now) {
        const t = Math.min((now - startTime) / durationMs, 1);
        const ease = 1 - Math.pow(1 - t, 2.8);
        const wheelRot = ease * finalWheelRotation;
        finalRot = wheelRot;
        drawWheel(wheelRot);
        if (t < 1) requestAnimationFrame(tick);
        else resolve(finalRot);
      }
      requestAnimationFrame(tick);
    });
  }

  async function resolveBets(winNumber) {
    let totalWin = 0;
    const isR = isRed(winNumber);
    const isOdd = winNumber !== 0 && winNumber % 2 === 1;
    const isEven = winNumber !== 0 && winNumber % 2 === 0;
    for (const [key, amount] of Object.entries(bets)) {
      let wins = false;
      if (key === String(winNumber)) wins = true;
      else if (key === 'red' && isR) wins = true;
      else if (key === 'black' && winNumber !== 0 && !isR) wins = true;
      else if (key === 'odd' && isOdd) wins = true;
      else if (key === 'even' && isEven) wins = true;
      else if (key === '1-18' && winNumber >= 1 && winNumber <= 18) wins = true;
      else if (key === '19-36' && winNumber >= 19 && winNumber <= 36) wins = true;
      else if (key === '1-12' && winNumber >= 1 && winNumber <= 12) wins = true;
      else if (key === '13-24' && winNumber >= 13 && winNumber <= 24) wins = true;
      else if (key === '25-36' && winNumber >= 25 && winNumber <= 36) wins = true;
      if (wins) {
        let mult = 1;
        if (key === String(winNumber)) mult = 35;
        else if (key === '1-12' || key === '13-24' || key === '25-36') mult = 2;
        totalWin += amount * (1 + mult);
      }
    }
    if (totalWin > 0) {
      const totalBet = getTotalBet();
      const effectiveMultiplier = totalBet > 0 ? Math.round((totalWin / totalBet) * 100) / 100 : 1;
      if (window.Stats && window.Stats.win) {
        await window.Stats.win(totalWin, effectiveMultiplier);
      } else {
        Game.win(totalWin, effectiveMultiplier);
      }
    }
    return totalWin;
  }

  function spin() {
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    if (isSpinning || getTotalBet() <= 0) return;
    if (Object.keys(bets).length > 0) {
      lastBets = JSON.parse(JSON.stringify(bets));
    }
    if (!window.Stats || !window.Stats.placeBet) Game.recordBet();
    lastWinNumber = null;
    updateWinnerHighlight();
    isSpinning = true;
    spinBtn.disabled = true;
    resultEl.textContent = '';
    const winNumber = Math.floor(Math.random() * 37);
    const durationMs = 4000 + Math.random() * 3000;
    animateSpin(winNumber, durationMs).then(async (finalRot) => {
      const won = await resolveBets(winNumber);
      const color = winNumber === 0 ? 'green' : isRed(winNumber) ? 'red' : 'black';
      resultEl.textContent = `Result: ${winNumber} (${color}). ${won > 0 ? 'Won ' + formatDollars(won) : 'No win.'}`;
      resultEl.className = 'roulette-result ' + (won > 0 ? 'win' : '');
      lastWinNumber = winNumber;
      bets = {};
      updateBetDisplay();
      updateWinnerHighlight();
      if (balanceUpdateCallback) balanceUpdateCallback();
      isSpinning = false;
      updateSpinButton();
      if (window.Auth && window.Auth.updateProfileStats) window.Auth.updateProfileStats();
    });
  }

  function onShow() {
    drawWheel(0);
  }

  function init() {
    renderChips();
    buildGrid();
    updateBetDisplay();
    updateSpinButton();
    drawWheel(0);
    if (spinBtn) spinBtn.addEventListener('click', spin);
    if (clearBetsBtn) clearBetsBtn.addEventListener('click', clearBets);
    if (redoBtn) redoBtn.addEventListener('click', redoLastBet);
    if (doubleBtn) doubleBtn.addEventListener('click', doubleLastBet);
  }

  function setBalanceUpdateCallback(fn) {
    balanceUpdateCallback = fn;
  }

  window.Roulette = {
    init,
    setBalanceUpdateCallback,
    updateBetDisplay,
    updateSpinButton,
    getTotalBet,
    onShow,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

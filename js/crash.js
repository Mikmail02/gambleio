/**
 * Crash game: multiplier rises from 1.00x; cash out before it crashes.
 * 2% house edge, RTP 98%. Exponential curve M(t) = e^(k*t), k = ln(2)/10 (~2× in 10s).
 */
(function () {
  const POLL_MS = 200;
  const CRASH_RTP = 98;
  const CRASH_K_DEFAULT = Math.LN2 / 10; // ~0.0693

  let canvas, ctx;
  let roundId = null;
  let phase = 'counting_down';
  let roundStartAt = null;
  let countdownEndAt = null;
  let crashPoint = null;
  let crashTime = null; // seconds until crash (from server when crashed)
  let crashK = CRASH_K_DEFAULT; // M(t) = e^(crashK * t)
  let myBet = null;
  let myCashOut = null;
  let pollTimer = null;
  let animId = null;
  let last10Crashes = [];
  let lastCrashedRoundId = null;

  function multAt(tSeconds) {
    return Math.exp(crashK * tSeconds);
  }

  function multDerivativeAt(tSeconds) {
    return crashK * Math.exp(crashK * tSeconds);
  }

  function getAuthHeaders() {
    if (typeof window.Auth !== 'undefined' && typeof window.Auth.getAuthHeaders === 'function') {
      return window.Auth.getAuthHeaders();
    }
    const token = typeof window.Auth !== 'undefined' && window.Auth.getToken ? window.Auth.getToken() : null;
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  async function fetchRound() {
    try {
      const res = await fetch('/api/crash/round', { headers: getAuthHeaders() });
      if (!res.ok) return { error: res.status };
      return await res.json();
    } catch (e) {
      return { error: 0 };
    }
  }

  function getCurrentMult(data) {
    if (data.phase !== 'flying' || data.roundStartAt == null) return null;
    const t = (data.serverTime - data.roundStartAt) / 1000;
    if (t >= data.crashTime) return data.crashPoint;
    return multAt(t);
  }

  let pollFailCount = 0;
  const POLL_FAIL_STOP = 3;

  function startPolling() {
    if (pollTimer) return;
    pollFailCount = 0;
    function poll() {
      fetchRound().then((data) => {
        if (data && data.error) {
          pollFailCount += 1;
          if (data.error === 404 && pollFailCount >= POLL_FAIL_STOP) {
            stopPolling();
            const phaseEl = document.getElementById('crashPhaseText');
            if (phaseEl) phaseEl.textContent = 'Crash unavailable — restart the server (node server.js)';
            if (pollFailCount === POLL_FAIL_STOP) console.warn('Crash API returned 404. Restart the server to enable Crash.');
          }
          pollTimer = setTimeout(poll, 2000);
          return;
        }
        pollFailCount = 0;
        if (!data || data.error) return;
        roundId = data.roundId;
        phase = data.phase;
        roundStartAt = data.roundStartAt;
        countdownEndAt = data.countdownEndAt;
        crashPoint = data.crashPoint;
        crashTime = typeof data.crashTime === 'number' ? data.crashTime : null;
        crashK = typeof data.crashK === 'number' ? data.crashK : CRASH_K_DEFAULT;
        if (data.phase === 'crashed' && data.crashPoint != null && data.roundId !== lastCrashedRoundId) {
          lastCrashedRoundId = data.roundId;
          last10Crashes = last10Crashes.concat(data.crashPoint).slice(-10);
        }
        const hadBet = myBet != null;
        const betAmt = typeof myBet === 'number' ? myBet : (myBet && myBet.amount) || 0;
        myBet = data.myBet;
        myCashOut = data.myCashOut;
        /* On crash: do nothing – bet was already recorded as -bet on place bet */
        if (data.balance != null && window.Game) window.Game.balance = data.balance;
        if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
        updateUI(data);
      });
      pollTimer = setTimeout(poll, POLL_MS);
    }
    poll();
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function getCountdownSeconds() {
    if (phase !== 'counting_down' || !countdownEndAt) return null;
    const s = Math.max(0, (countdownEndAt - Date.now()) / 1000);
    return Math.ceil(s);
  }

  function updateUI(data) {
    const multEl = document.getElementById('crashMultiplier');
    const phaseEl = document.getElementById('crashPhaseText');
    const betBtn = document.getElementById('crashBetBtn');
    const cashOutBtn = document.getElementById('crashCashOutBtn');
    const betInput = document.getElementById('crashBetAmount');
    const crashResult = document.getElementById('crashResult');

    if (phaseEl) {
      if (phase === 'counting_down') {
        const sec = getCountdownSeconds();
        phaseEl.textContent = sec != null && sec > 0 ? 'Next round in ' + sec + 's...' : 'Next round in...';
      } else if (phase === 'flying') phaseEl.textContent = 'Cash out before it crashes!';
      else if (phase === 'crashed') phaseEl.textContent = 'Crashed!';
    }

    if (phase === 'crashed' && crashPoint != null) {
      if (multEl) multEl.textContent = crashPoint.toFixed(2) + '×';
      if (crashResult) {
        crashResult.textContent = 'Crashed at ' + crashPoint.toFixed(2) + '×';
        crashResult.classList.remove('hidden');
        crashResult.classList.add('crash-result-loss');
      }
    } else if (phase === 'flying') {
      if (crashResult) crashResult.classList.add('hidden');
    } else {
      if (multEl) multEl.textContent = '1.00×';
      if (crashResult) crashResult.classList.add('hidden');
    }

    if (betBtn) {
      betBtn.disabled = phase !== 'counting_down' || myBet != null || !betInput || parseFloat(betInput.value) <= 0;
    }
    if (cashOutBtn) {
      cashOutBtn.disabled = phase !== 'flying' || myCashOut != null || myBet == null;
    }
    if (betInput) betInput.disabled = myBet != null;

    if (myCashOut && multEl) {
      multEl.textContent = myCashOut.multiplier.toFixed(2) + '×';
      if (crashResult) {
        crashResult.textContent = 'Cashed out at ' + myCashOut.multiplier.toFixed(2) + '× — +$' + (myCashOut.winAmount - myCashOut.amount).toFixed(2);
        crashResult.classList.remove('hidden', 'crash-result-loss');
        crashResult.classList.add('crash-result-win');
      }
    } else if (crashResult && crashResult.classList.contains('crash-result-win')) {
      crashResult.classList.remove('crash-result-win');
    }

    const listEl = document.getElementById('crashActivityList');
    if (listEl) {
      const cashOuts = Array.isArray(data?.cashOutsList) ? data.cashOutsList : [];
      const losers = Array.isArray(data?.losersList) ? data.losersList : [];
      const parts = [];
      cashOuts.forEach((o) => {
        const win = Number(o.winAmount);
        parts.push({ type: 'cashout', username: o.username, mult: o.multiplier, text: (win ? '+' : '') + '$' + (win ? win.toFixed(2) : '0.00'), green: true });
      });
      losers.forEach((o) => {
        parts.push({ type: 'loser', username: o.username, mult: o.multiplier, text: '$0', green: false });
      });
      listEl.innerHTML = parts.length ? parts.map((p) => {
        const multStr = (typeof p.mult === 'number' ? p.mult.toFixed(2) : p.mult) + '×';
        const cls = p.green ? 'crash-activity-item crash-activity-win' : 'crash-activity-item crash-activity-loss';
        return `<div class="${cls}"><span class="crash-activity-user">${escapeHtml(p.username)}</span> — <span class="crash-activity-mult">${multStr}</span> — ${escapeHtml(p.text)}</div>`;
      }).join('') : '';
    }

    const recentEl = document.getElementById('crashRecentList');
    if (recentEl) {
      const list = last10Crashes.slice(-10);
      const slots = 10;
      const pills = [];
      for (let i = 0; i < slots; i++) {
        const idx = list.length - slots + i;
        const m = idx >= 0 ? list[idx] : null;
        const str = m != null ? (typeof m === 'number' ? m.toFixed(2) : String(m)) + '×' : '—';
        const isLatest = list.length > 0 && i === slots - 1;
        const cls = isLatest ? 'crash-recent-pill crash-recent-pill--latest' : 'crash-recent-pill';
        pills.push(`<span class="${cls}" ${isLatest ? 'aria-label="Siste runde" title="Last round"' : ''}>${escapeHtml(str)}</span>`);
      }
      recentEl.innerHTML = pills.join('');
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function drawChart() {
    if (!canvas || !ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const now = Date.now();

    let currentMult = 1;
    let crashed = false;
    let displayCrashPoint = null;
    if (phase === 'flying' && roundStartAt != null) {
      const t = (now - roundStartAt) / 1000;
      currentMult = multAt(t);
    } else if (phase === 'crashed' && crashPoint != null) {
      crashed = true;
      displayCrashPoint = crashPoint;
      currentMult = crashPoint;
    }

    const maxMult = Math.max(currentMult * 1.15, 2);
    const minMult = 0.98;
    const padding = { top: 24, right: 24, bottom: 24, left: 56 };
    const chartLeft = padding.left;
    const chartRight = width - padding.right;
    const chartTop = padding.top;
    const chartBottom = height - padding.bottom;
    const chartWidth = chartRight - chartLeft;
    const chartHeight = chartBottom - chartTop;
    const lineWidth = chartWidth * 0.72;

    function yToScreen(m) {
      const p = (Math.log(m) - Math.log(minMult)) / (Math.log(maxMult) - Math.log(minMult));
      return chartBottom - p * chartHeight;
    }

    ctx.fillStyle = 'rgba(13, 15, 20, 0.95)';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartLeft, chartTop);
    ctx.lineTo(chartLeft, chartBottom);
    ctx.lineTo(chartRight, chartBottom);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '12px var(--font, "DM Sans"), sans-serif';
    ctx.textAlign = 'right';
    const steps = [1, 2, 5, 10, 20, 50, 100].filter((m) => m <= maxMult);
    steps.forEach((m) => {
      const y = yToScreen(m);
      if (y >= chartTop - 4 && y <= chartBottom + 4) {
        ctx.fillText(m + '×', chartLeft - 8, y + 4);
        ctx.beginPath();
        ctx.moveTo(chartLeft, y);
        ctx.lineTo(chartLeft + 4, y);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.stroke();
      }
    });

    const points = [];
    let tMax = 0;
    if (phase === 'flying' && roundStartAt != null) {
      tMax = (now - roundStartAt) / 1000;
    } else if (phase === 'crashed' && crashPoint != null) {
      tMax = crashTime != null && crashTime > 0 ? crashTime : (Math.log(crashPoint) / crashK);
    }
    const n = 80;
    const tMaxSafe = Math.max(tMax, 0.001);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * tMax;
      const m = multAt(t);
      if (m > maxMult * 1.1) break;
      points.push({ t, m, x: chartLeft + (t / tMaxSafe) * lineWidth, y: yToScreen(m) });
    }

    if (points.length >= 2) {
      const gradient = ctx.createLinearGradient(chartLeft, chartTop, chartRight, chartBottom);
      gradient.addColorStop(0, 'rgba(0, 212, 170, 0.4)');
      gradient.addColorStop(1, 'rgba(0, 212, 170, 0.95)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();

      const last = points[points.length - 1];
      const arrowLen = 14;
      const tLast = typeof last.t === 'number' ? last.t : tMax;
      const dmultDt = multDerivativeAt(tLast);
      let dirX = lineWidth / tMaxSafe;
      const logRange = Math.log(maxMult) - Math.log(minMult);
      const dyDm = -chartHeight / (logRange * Math.max(0.01, last.m));
      let dirY = dyDm * dmultDt;
      const len = Math.hypot(dirX, dirY) || 1;
      dirX /= len;
      dirY /= len;
      const tipX = last.x + arrowLen * dirX;
      const tipY = last.y + arrowLen * dirY;
      const backX = last.x - arrowLen * 0.6 * dirX;
      const backY = last.y - arrowLen * 0.6 * dirY;
      const wing = arrowLen * 0.5;
      const perpX = -dirY;
      const perpY = dirX;
      ctx.fillStyle = 'rgba(0, 212, 170, 0.95)';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(backX + perpX * wing, backY + perpY * wing);
      ctx.lineTo(backX - perpX * wing, backY - perpY * wing);
      ctx.closePath();
      ctx.fill();
    }

    if (crashed && displayCrashPoint != null) {
      ctx.fillStyle = 'rgba(255, 71, 87, 0.9)';
      ctx.font = 'bold 14px var(--font, "DM Sans"), sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('CRASHED @ ' + displayCrashPoint.toFixed(2) + '×', chartLeft, chartTop - 6);
    }
  }

  function tick() {
    drawChart();
    if (phase === 'flying' && roundStartAt != null) {
      const t = (Date.now() - roundStartAt) / 1000;
      const multEl = document.getElementById('crashMultiplier');
      const m = multAt(t);
      if (multEl) multEl.textContent = (m >= 1e6 ? '∞' : m.toFixed(2)) + '×';
    } else if (phase === 'counting_down') {
      const sec = getCountdownSeconds();
      const phaseEl = document.getElementById('crashPhaseText');
      if (phaseEl && sec != null && sec > 0) phaseEl.textContent = 'Next round in ' + sec + 's...';
    }
    animId = requestAnimationFrame(tick);
  }

  function onShow() {
    canvas = document.getElementById('crashChart');
    if (canvas) {
      ctx = canvas.getContext('2d');
      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawChart();
      };
      resize();
      window.addEventListener('resize', resize);
      if (!animId) tick();
    }
    startPolling();
  }

  function onHide() {
    stopPolling();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-crash');
    if (!page) return;

    const betInput = document.getElementById('crashBetAmount');
    const betBtn = document.getElementById('crashBetBtn');
    const cashOutBtn = document.getElementById('crashCashOutBtn');

    if (betBtn) {
      betBtn.addEventListener('click', async () => {
        const amount = parseFloat(betInput?.value);
        if (!Number.isFinite(amount) || amount <= 0) return;
        if (window.Auth && !window.Auth.getCurrentUser?.()) {
          if (window.Auth.requireAuth) window.Auth.requireAuth(() => {});
          return;
        }
        try {
          const res = await fetch('/api/crash/bet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ amount }),
          });
          const data = res.ok ? await res.json() : await res.json().catch(() => ({}));
          if (!res.ok) {
            alert(res.status === 404 ? 'Crash is unavailable. Restart the server (node server.js).' : (data.error || 'Bet failed'));
            return;
          }
          if (window.Game) window.Game.balance = data.balance;
          if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
          myBet = amount;
          if (window.LiveStats) window.LiveStats.recordBetPlaced('crash', amount);
          updateUI({ phase, myBet: amount, balance: data.balance });
        } catch (e) {
          alert('Bet failed');
        }
      });
    }

    if (cashOutBtn) {
      cashOutBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/crash/cash-out', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({}),
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || 'Cash out failed');
            return;
          }
          if (window.Game) window.Game.balance = data.balance;
          if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
          myCashOut = { amount: myBet, multiplier: data.multiplier, winAmount: data.winAmount };
          if (window.LiveStats) window.LiveStats.recordRound('crash', myBet, data.winAmount);
          updateUI({ phase, myCashOut: myCashOut, balance: data.balance });
        } catch (e) {
          alert('Cash out failed');
        }
      });
    }

    if (betInput) {
      betInput.addEventListener('input', () => updateUI({}));
      betInput.addEventListener('change', () => updateUI({}));
    }
  });

  window.Crash = {
    onShow,
    onHide,
    fetchRound,
    updateUI,
    getCurrentMult,
  };
})();

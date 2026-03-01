/**
 * Main: navigation (Home / Plinko), Home clicker, Plinko drop (replay), last multipliers (10).
 */
(function () {
  const balanceEl = document.getElementById('balance');
  const betInput = document.getElementById('bet');
  const dropBtn = document.getElementById('dropBall');
  const lastResultEl = document.getElementById('lastResult');
  const lastMultipliersList = document.getElementById('lastMultipliersList');
  const pageHome = document.getElementById('page-home');
  const pagePlinko = document.getElementById('page-plinko');
  const pageRoulette = document.getElementById('page-roulette');
  const pageSlots = document.getElementById('page-slots');
  const pageSlotGame = document.getElementById('page-slot-game');
  const navLinks = document.querySelectorAll('.nav-link');
  const clickerBtn = document.getElementById('clickerBtn');
  const riskLevelCurrent = document.getElementById('riskLevelCurrent');
  const buyMedium = document.getElementById('buyMedium');
  const buyHigh = document.getElementById('buyHigh');
  const buyExtreme = document.getElementById('buyExtreme');
  const costMedium = document.getElementById('costMedium');
  const costHigh = document.getElementById('costHigh');
  const costExtreme = document.getElementById('costExtreme');
  const plinkoModeManualBtn = document.getElementById('plinkoModeManual');
  const plinkoModeAutomaticBtn = document.getElementById('plinkoModeAutomatic');
  const plinkoAutoBetsGroup = document.getElementById('plinkoAutoBetsGroup');
  const plinkoAutoBetsInput = document.getElementById('plinkoAutoBets');

  const LAST_MULTIPLIERS_MAX = 10;
  const PLINKO_AUTO_DROP_DELAY_MS = 200; // 5 balls per second
  let lastMultipliers = [];
  let plinkoSessionBet = 0;
  let plinkoSessionWon = 0;
  let plinkoControlMode = 'manual';
  let plinkoAutoRunning = false;

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  }

  function updateBalance() {
    if (balanceEl && window.Auth && window.Auth.getCurrentUser && window.Auth.getCurrentUser()) {
      balanceEl.textContent = formatDollars(Game.getBalance());
    }
    if (window.Auth && window.Auth.updateBalance) {
      window.Auth.updateBalance();
    }
    if (window.Auth && window.Auth.updateProfileBalance) {
      window.Auth.updateProfileBalance();
    }
    if (window.Auth && window.Auth.refreshRankBadge) {
      window.Auth.refreshRankBadge();
    }
  }

  function updateDropButton() {
    if (!dropBtn) return;
    const bet = Game.getBet();
    const canBet = Game.canBet(bet);
    const activeBalls = window.Plinko && Plinko.getActiveBallCount ? Plinko.getActiveBallCount() : 0;
    const atMax = activeBalls >= (Plinko && Plinko.maxActiveBalls ? Plinko.maxActiveBalls : 25);
    dropBtn.disabled = plinkoAutoRunning ? false : (!canBet || atMax);
    dropBtn.textContent = plinkoAutoRunning ? 'Stop' : (plinkoControlMode === 'automatic' ? 'Start auto' : 'Drop ball');
  }

  function setPlinkoControlMode(mode) {
    plinkoControlMode = mode === 'automatic' ? 'automatic' : 'manual';
    if (plinkoModeManualBtn) plinkoModeManualBtn.classList.toggle('is-active', plinkoControlMode === 'manual');
    if (plinkoModeAutomaticBtn) plinkoModeAutomaticBtn.classList.toggle('is-active', plinkoControlMode === 'automatic');
    if (plinkoAutoBetsGroup) plinkoAutoBetsGroup.classList.toggle('hidden', plinkoControlMode !== 'automatic');
    if (plinkoControlMode !== 'automatic') {
      stopPlinkoAuto();
    }
    updateDropButton();
  }

  function getAutoTargetCount() {
    if (!plinkoAutoBetsInput) return Infinity;
    const raw = String(plinkoAutoBetsInput.value || '').trim();
    if (!raw) return Infinity;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.max(1, n);
  }

  function stopPlinkoAuto() {
    plinkoAutoRunning = false;
    updateDropButton();
  }

  async function runPlinkoAuto() {
    if (plinkoAutoRunning) return;
    const target = getAutoTargetCount();
    if (target === null) {
      alert('Auto bets must be a whole number greater than 0.');
      return;
    }
    plinkoAutoRunning = true;
    updateDropButton();
    let dropped = 0;
    while (plinkoAutoRunning) {
      if (plinkoControlMode !== 'automatic') break;
      if (document.hidden) break;
      if ((window.location.hash || '#home') !== '#plinko') break;
      if (Number.isFinite(target) && dropped >= target) break;
      const activeBalls = window.Plinko && window.Plinko.getActiveBallCount ? window.Plinko.getActiveBallCount() : 0;
      const maxBalls = window.Plinko && window.Plinko.maxActiveBalls ? window.Plinko.maxActiveBalls : 25;
      if (activeBalls >= maxBalls) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const ok = await handleDrop();
      if (ok) dropped += 1;
      await new Promise((resolve) => setTimeout(resolve, PLINKO_AUTO_DROP_DELAY_MS));
    }
    plinkoAutoRunning = false;
    updateDropButton();
  }

  function setLastResult(text, isWin) {
    if (!lastResultEl) return;
    lastResultEl.textContent = text;
    lastResultEl.className = 'last-result' + (isWin ? ' win' : text ? ' loss' : '');
  }

  function updatePlinkoSessionPnl() {
    const el = document.getElementById('plinkoSessionValue');
    if (!el) return;
    const pnl = plinkoSessionWon - plinkoSessionBet;
    el.textContent = (pnl >= 0 ? '+' : '') + formatDollars(pnl);
    el.className = 'plinko-session-value' + (pnl > 0 ? ' plinko-session-profit' : pnl < 0 ? ' plinko-session-loss' : '');
  }

  function addLastMultiplier(multiplier) {
    lastMultipliers.unshift(multiplier);
    if (lastMultipliers.length > LAST_MULTIPLIERS_MAX) lastMultipliers = lastMultipliers.slice(0, LAST_MULTIPLIERS_MAX);
    renderLastMultipliers();
  }

  function updateRiskLevelUI() {
    if (!riskLevelCurrent) return;
    const level = Game.getPlinkoRiskLevel();
    riskLevelCurrent.textContent = level.charAt(0).toUpperCase() + level.slice(1);
    const costs = Game.plinkoRiskCosts;
    if (costMedium) costMedium.textContent = Game.plinkoRiskUnlocked.medium ? '✓' : formatDollars(costs.medium);
    if (costHigh) costHigh.textContent = Game.plinkoRiskUnlocked.high ? '✓' : formatDollars(costs.high);
    if (costExtreme) costExtreme.textContent = Game.plinkoRiskUnlocked.extreme ? '✓' : formatDollars(costs.extreme);
    document.querySelectorAll('.btn-risk').forEach((btn) => {
      const r = btn.getAttribute('data-risk');
      btn.classList.toggle('active', Game.getPlinkoRiskLevel() === r);
      btn.disabled = r === 'low' ? false : (r === 'medium' ? Game.plinkoRiskUnlocked.medium : (r === 'high' ? Game.plinkoRiskUnlocked.high : Game.plinkoRiskUnlocked.extreme)) ? false : !Game.canUnlockPlinkoRisk(r);
    });
  }

  function renderLastMultipliers() {
    if (!lastMultipliersList) return;
    lastMultipliersList.innerHTML = lastMultipliers
      .map((m) => {
        const cls = m >= 2 ? 'mult-high' : m <= 0.5 ? 'mult-low' : '';
        return `<div class="mult-item ${cls}">${m}×</div>`;
      })
      .join('');
  }

  const pageProfile = document.getElementById('page-profile');
  const pageLeaderboard = document.getElementById('page-leaderboard');

  function showPage(pageId, profileUsername) {
    if (pageHome) pageHome.classList.toggle('hidden', pageId !== 'home');
    if (pagePlinko) pagePlinko.classList.toggle('hidden', pageId !== 'plinko');
    if (pageRoulette) pageRoulette.classList.toggle('hidden', pageId !== 'roulette');
    if (pageSlots) pageSlots.classList.toggle('hidden', pageId !== 'slots');
    if (pageSlotGame) pageSlotGame.classList.toggle('hidden', pageId !== 'slot-game');
    if (pageProfile) pageProfile.classList.toggle('hidden', pageId !== 'profile');
    if (pageLeaderboard) pageLeaderboard.classList.toggle('hidden', pageId !== 'leaderboard');
    navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('data-page') === pageId));
    if (pageId === 'plinko') {
      updateDropButton();
      updateRiskLevelUI();
      updatePlinkoSessionPnl();
      setPlinkoControlMode(plinkoControlMode);
      if (window.Plinko && window.Plinko.updateMultipliers) {
        window.Plinko.updateMultipliers();
      }
      if (window.Plinko && window.Plinko.recenterBoard) {
        requestAnimationFrame(() => {
          window.Plinko.recenterBoard();
          setTimeout(() => window.Plinko.recenterBoard(), 120);
        });
      }
    }
    if (pageId !== 'plinko') {
      stopPlinkoAuto();
    }
    if (pageId === 'roulette') {
      if (window.Roulette) {
        window.Roulette.setBalanceUpdateCallback(updateBalance);
        window.Roulette.updateBetDisplay();
        window.Roulette.updateSpinButton();
        if (window.Roulette.onShow) window.Roulette.onShow();
      }
    }
    if (pageId === 'profile') {
      updateBalance();
      if (window.Auth && window.Auth.showProfile) {
        window.Auth.showProfile(profileUsername);
      }
    }
    if (pageId === 'leaderboard') {
      if (window.Leaderboard) {
        // Wire up tab buttons
        document.querySelectorAll('.leaderboard-tab').forEach(btn => {
          btn.onclick = () => window.Leaderboard.switchTab(btn.dataset.tab);
        });
        window.Leaderboard.switchTab(window.Leaderboard.currentTab);
      }
    } else if (window.Leaderboard && window.Leaderboard.closeDetail) {
      window.Leaderboard.closeDetail();
    }
    // Slot game: init when page is shown (either via hash or via showPage('slot-game') from Play button)
    if (pageId === 'slot-game' && window.SlotIntegration && window.SlotIntegration.initialize) {
      setTimeout(() => {
        try {
          window.SlotIntegration.initialize();
        } catch (e) {
          console.error('[main.js] SlotIntegration.initialize error:', e);
        }
      }, 100);
    }
  }

  function onHashChange() {
    const hash = (window.location.hash || '#home').slice(1);
    const validPages = ['home', 'plinko', 'roulette', 'slots', 'slot-game', 'profile', 'leaderboard'];
    let page = validPages.includes(hash) ? hash : 'home';
    if (hash.startsWith('profile/')) {
      page = 'profile';
    }
    showPage(page, hash.startsWith('profile/') ? decodeURIComponent(hash.slice(hash.indexOf('/') + 1)) : (page === 'profile' ? null : undefined));
    
    // Small delay to ensure page is visible before initializing
    setTimeout(() => {
      if (page === 'slots' && window.Slots && window.Slots.onShow) {
        window.Slots.onShow();
      }
    if (page === 'slot-game') {
      console.log('[main.js] slot-game page detected, initializing...');
      // Initialize slot game when page is shown
      setTimeout(() => {
        console.log('[main.js] Checking for SlotIntegration...', {
          SlotIntegration: !!window.SlotIntegration,
          hasInitialize: !!(window.SlotIntegration && window.SlotIntegration.initialize),
          Slots: !!window.Slots,
          hasOnGameShow: !!(window.Slots && window.Slots.onGameShow)
        });
        if (window.SlotIntegration && window.SlotIntegration.initialize) {
          console.log('[main.js] Calling window.SlotIntegration.initialize()...');
          try {
            window.SlotIntegration.initialize();
            console.log('[main.js] window.SlotIntegration.initialize() called successfully');
          } catch(e) {
            console.error('[main.js] Error calling SlotIntegration.initialize():', e);
            console.error('[main.js] Stack:', e.stack);
          }
        } else if (window.Slots && window.Slots.onGameShow) {
          console.log('[main.js] Calling window.Slots.onGameShow()...');
          window.Slots.onGameShow();
        } else {
          console.error('[main.js] Neither SlotIntegration.initialize nor Slots.onGameShow found!');
        }
      }, 100);
    }
    }, 50);
  }

  async function handleDrop() {
    const bet = Game.getBet();
    if (!Game.canBet(bet)) return false;

    const placeResult = window.Stats && window.Stats.placeBet
      ? await window.Stats.placeBet(bet)
      : (Game.placeBet(bet) ? { balance: Game.balance } : null);
    if (!placeResult) {
      if (!window.Auth || !window.Auth.isAuthenticated()) return false;
      alert('Insufficient balance or server error.');
      return false;
    }
    if (!window.Stats || !window.Stats.placeBet) Game.recordBet();
    plinkoSessionBet += bet;
    updateBalance();
    updateDropButton();
    updatePlinkoSessionPnl();

    const added = window.Plinko && window.Plinko.dropBall(bet, async (result) => {
      if (window.Stats && window.Stats.recordPlinkoLand) {
        window.Stats.recordPlinkoLand(result.slotIndex, bet, result.multiplier);
      }
      if (window.Stats && window.Stats.win) {
        await window.Stats.win(result.winAmount, result.multiplier, bet);
      } else {
        Game.win(result.winAmount, result.multiplier, bet);
      }
      plinkoSessionWon += result.winAmount;
      updatePlinkoSessionPnl();
      updateBalance();
      addLastMultiplier(result.multiplier);
      const winText = result.multiplier >= 1 
        ? `${result.multiplier}× → ${formatDollars(result.winAmount)}`
        : `${result.multiplier}× → ${formatDollars(result.winAmount)}`;
      setLastResult(winText, result.multiplier >= 1);
      updateDropButton();
      if (window.Auth && window.Auth.updateProfileStats) window.Auth.updateProfileStats();
    });

    if (!added) {
      plinkoSessionWon += bet;
      updatePlinkoSessionPnl();
      if (window.Stats && window.Stats.win) {
        await window.Stats.win(bet, 1, bet);
      } else {
        Game.win(bet, 1, bet);
      }
      updateBalance();
      updateDropButton();
      if (window.Auth && window.Auth.updateProfileStats) window.Auth.updateProfileStats();
    }
    return !!added;
  }

  function onBetInput() {
    const val = parseFloat(betInput.value);
    if (!Number.isNaN(val)) Game.setBet(val);
    updateDropButton();
  }

  // Clicker: accumulate locally, send to server every 10s; rate limit >10/sec -> block 5–20s
  const CLICK_RATE_WINDOW_MS = 1000;
  const CLICK_RATE_MAX = 10;
  const CLICK_BLOCK_INITIAL_S = 5;
  const CLICK_BLOCK_MAX_S = 20;
  const CLICK_BLOCK_ESCALATE_S = 2.5;
  const CLICK_BLOCK_COOLDOWN_MS = 10000;
  const CLICK_SEND_INTERVAL_MS = 10000;

  let pendingClickAmount = 0;
  let pendingClickCount = 0;
  let clickTimestamps = [];
  let blockUntil = 0;
  let blockDurationSec = CLICK_BLOCK_INITIAL_S;
  let lastUnblockTime = 0;
  let clickBlockToastEl = null;
  let clickBlockSecondsEl = null;

  function isClickBlocked() {
    return Date.now() < blockUntil;
  }

  function showClickBlockToast(secondsLeft) {
    if (!clickBlockSecondsEl) {
      clickBlockToastEl = document.getElementById('clickBlockToast');
      clickBlockSecondsEl = document.getElementById('clickBlockSeconds');
    }
    if (clickBlockToastEl && clickBlockSecondsEl) {
      clickBlockSecondsEl.textContent = Math.max(0, Math.ceil(secondsLeft));
      clickBlockToastEl.classList.remove('hidden');
    }
  }

  function hideClickBlockToast() {
    if (clickBlockToastEl) clickBlockToastEl.classList.add('hidden');
  }

  function onClickerClick() {
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    const now = Date.now();
    if (isClickBlocked()) {
      showClickBlockToast((blockUntil - now) / 1000);
      return;
    }
    clickTimestamps.push(now);
    clickTimestamps = clickTimestamps.filter((t) => t > now - CLICK_RATE_WINDOW_MS);
    if (clickTimestamps.length > CLICK_RATE_MAX) {
      const withinCooldown = now - lastUnblockTime <= CLICK_BLOCK_COOLDOWN_MS;
      if (withinCooldown) {
        blockDurationSec = Math.min(CLICK_BLOCK_MAX_S, blockDurationSec + CLICK_BLOCK_ESCALATE_S);
      } else {
        blockDurationSec = CLICK_BLOCK_INITIAL_S;
      }
      blockUntil = now + blockDurationSec * 1000;
      showClickBlockToast(blockDurationSec);
      clickTimestamps = [];
      return;
    }
    pendingClickAmount += Game.clickEarning;
    pendingClickCount += 1;
    Game.balance += Game.clickEarning;
    if (Game.rewardClickXP) Game.rewardClickXP();
    const floatsEl = document.getElementById('clickerFloats');
    if (floatsEl) {
      const span = document.createElement('span');
      span.className = 'clicker-float-text';
      span.textContent = '+$' + Game.clickEarning;
      floatsEl.appendChild(span);
      setTimeout(() => span.remove(), 1100);
    }
    if (!window.Stats || !window.Stats.sendClickEarnings) {
      Game.totalClickEarnings = (Game.totalClickEarnings || 0) + Game.clickEarning;
      Game.totalClicks = (Game.totalClicks || 0) + 1;
    }
    updateBalance();
  }

  setInterval(() => {
    const now = Date.now();
    if (blockUntil > 0 && now >= blockUntil) {
      lastUnblockTime = now;
      blockUntil = 0;
      hideClickBlockToast();
    }
    if (blockUntil > 0) {
      showClickBlockToast((blockUntil - now) / 1000);
    }
  }, 1000);

  async function flushPendingClickEarnings() {
    if (pendingClickAmount <= 0) return;
    const toSend = pendingClickAmount;
    const countToSend = pendingClickCount;
    pendingClickAmount = 0;
    pendingClickCount = 0;
    if (window.Stats && window.Stats.sendClickEarnings) {
      const result = await window.Stats.sendClickEarnings(toSend, countToSend);
      if (result == null) {
        pendingClickAmount += toSend;
        pendingClickCount += countToSend;
        Game.balance -= toSend;
      }
      updateBalance();
    } else {
      Game.totalClickEarnings = (Game.totalClickEarnings || 0);
      updateBalance();
    }
  }

  setInterval(flushPendingClickEarnings, CLICK_SEND_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushPendingClickEarnings();
  });

  let autoClickerActive = false;
  let autoClickerInterval = null;
  const AUTO_CLICK_RATE = 9;
  const autoClickerToggle = document.getElementById('autoClickerToggle');
  const autoClickerIcon = document.getElementById('autoClickerIcon');
  const autoClickerText = document.getElementById('autoClickerText');

  function startAutoClicker() {
    if (autoClickerInterval) return;
    autoClickerActive = true;
    if (autoClickerToggle) autoClickerToggle.classList.add('active');
    if (autoClickerIcon) autoClickerIcon.textContent = '\u25A0';
    if (autoClickerText) autoClickerText.textContent = 'Auto-Click: ON';
    autoClickerInterval = setInterval(() => {
      if (!autoClickerActive || isClickBlocked()) return;
      if (clickerBtn) {
        onClickerClick();
      }
    }, 1000 / AUTO_CLICK_RATE);
  }

  function stopAutoClicker() {
    autoClickerActive = false;
    if (autoClickerInterval) {
      clearInterval(autoClickerInterval);
      autoClickerInterval = null;
    }
    if (autoClickerToggle) autoClickerToggle.classList.remove('active');
    if (autoClickerIcon) autoClickerIcon.textContent = '\u25B6';
    if (autoClickerText) autoClickerText.textContent = 'Auto-Click: OFF';
  }

  if (autoClickerToggle) {
    autoClickerToggle.addEventListener('click', () => {
      autoClickerActive = !autoClickerActive;
      if (autoClickerActive) startAutoClicker();
      else stopAutoClicker();
    });
  }

  if (clickerBtn) {
    clickerBtn.addEventListener('click', onClickerClick);
  }
  const clickerIntervalSecEl = document.getElementById('clickerIntervalSec');
  if (clickerIntervalSecEl) {
    clickerIntervalSecEl.textContent = CLICK_SEND_INTERVAL_MS / 1000;
  }

  updateBalance();
  setPlinkoControlMode(plinkoControlMode);
  updateDropButton();
  renderLastMultipliers();

  if (dropBtn) {
    dropBtn.addEventListener('click', () => {
      if (plinkoControlMode === 'automatic') {
        if (plinkoAutoRunning) stopPlinkoAuto();
        else runPlinkoAuto();
        return;
      }
      handleDrop();
    });
  }
  if (plinkoModeManualBtn) plinkoModeManualBtn.addEventListener('click', () => setPlinkoControlMode('manual'));
  if (plinkoModeAutomaticBtn) plinkoModeAutomaticBtn.addEventListener('click', () => setPlinkoControlMode('automatic'));
  if (betInput) {
    betInput.addEventListener('input', onBetInput);
    betInput.addEventListener('change', onBetInput);
  }

  document.querySelectorAll('.btn-risk').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
      const risk = btn.getAttribute('data-risk');
      if (risk === 'low') {
        if (window.Stats && window.Stats.setPlinkoRiskLevel) {
          const result = await window.Stats.setPlinkoRiskLevel('low');
          if (result && result.error) return;
        } else {
          Game.setPlinkoRiskLevel('low');
        }
        updateBalance();
        updateRiskLevelUI();
        if (window.Plinko && window.Plinko.updateMultipliers) {
          window.Plinko.updateMultipliers();
        }
        return;
      }
      if (Game.plinkoRiskUnlocked[risk]) {
        if (window.Stats && window.Stats.setPlinkoRiskLevel) {
          const result = await window.Stats.setPlinkoRiskLevel(risk);
          if (result && result.error) return;
        } else {
          Game.setPlinkoRiskLevel(risk);
        }
        updateBalance();
        updateRiskLevelUI();
        if (window.Plinko && window.Plinko.updateMultipliers) {
          window.Plinko.updateMultipliers();
        }
        return;
      }
      if (Game.canUnlockPlinkoRisk(risk) && window.Stats && window.Stats.setPlinkoRiskLevel) {
        const result = await window.Stats.setPlinkoRiskLevel(risk);
        if (result && !result.error) {
          updateBalance();
          updateRiskLevelUI();
          if (window.Plinko && window.Plinko.updateMultipliers) {
            window.Plinko.updateMultipliers();
          }
        } else if (result && result.error) {
          if (typeof alert === 'function') alert(result.error);
        }
      } else if (Game.canUnlockPlinkoRisk(risk)) {
        if (Game.unlockPlinkoRisk(risk)) {
          updateBalance();
          updateRiskLevelUI();
          if (window.Plinko && window.Plinko.updateMultipliers) {
            window.Plinko.updateMultipliers();
          }
        }
      }
    });
  });

  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPlinkoAuto();
  });
  window.addEventListener('beforeunload', () => stopPlinkoAuto());
  window.showPage = showPage;
  onHashChange();

  setInterval(updateDropButton, 300);
  setInterval(updateRiskLevelUI, 500);
})();

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
  const clickerAmountEl = document.getElementById('clickerAmount');
  const riskLevelCurrent = document.getElementById('riskLevelCurrent');
  const buyMedium = document.getElementById('buyMedium');
  const buyHigh = document.getElementById('buyHigh');
  const buyExtreme = document.getElementById('buyExtreme');
  const costMedium = document.getElementById('costMedium');
  const costHigh = document.getElementById('costHigh');
  const costExtreme = document.getElementById('costExtreme');

  const LAST_MULTIPLIERS_MAX = 10;
  let lastMultipliers = [];

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
    dropBtn.disabled = !canBet || atMax;
  }

  function setLastResult(text, isWin) {
    if (!lastResultEl) return;
    lastResultEl.textContent = text;
    lastResultEl.className = 'last-result' + (isWin ? ' win' : text ? ' loss' : '');
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

  function showPage(pageId) {
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
    }
    if (pageId === 'leaderboard') {
      if (window.Leaderboard) {
        // Wire up tab buttons
        document.querySelectorAll('.leaderboard-tab').forEach(btn => {
          btn.onclick = () => window.Leaderboard.switchTab(btn.dataset.tab);
        });
        window.Leaderboard.switchTab(window.Leaderboard.currentTab);
      }
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
    const page = validPages.includes(hash) ? hash : 'home';
    showPage(page);
    
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
    if (!Game.canBet(bet)) return;

    const placeResult = window.Stats && window.Stats.placeBet
      ? await window.Stats.placeBet(bet)
      : (Game.placeBet(bet) ? { balance: Game.balance } : null);
    if (!placeResult) {
      if (!window.Auth || !window.Auth.isAuthenticated()) return;
      alert('Insufficient balance or server error.');
      return;
    }
    if (!window.Stats || !window.Stats.placeBet) Game.recordBet();
    updateBalance();
    updateDropButton();

    const added = window.Plinko && window.Plinko.dropBall(bet, async (result) => {
      if (window.Stats && window.Stats.win) {
        await window.Stats.win(result.winAmount, result.multiplier, bet);
      } else {
        Game.win(result.winAmount, result.multiplier, bet);
      }
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
      if (window.Stats && window.Stats.win) {
        await window.Stats.win(bet, 1, bet);
      } else {
        Game.win(bet, 1, bet);
      }
      updateBalance();
      updateDropButton();
      if (window.Auth && window.Auth.updateProfileStats) window.Auth.updateProfileStats();
    }
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
    if (Game.rewardClickXP) Game.rewardClickXP();
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

  setInterval(async () => {
    if (pendingClickAmount <= 0) return;
    const toSend = pendingClickAmount;
    const countToSend = pendingClickCount;
    pendingClickAmount = 0;
    pendingClickCount = 0;
    if (window.Stats && window.Stats.sendClickEarnings) {
      await window.Stats.sendClickEarnings(toSend, countToSend);
      updateBalance();
    } else {
      Game.balance += toSend;
      Game.totalClickEarnings = (Game.totalClickEarnings || 0);
      updateBalance();
    }
  }, CLICK_SEND_INTERVAL_MS);

  if (clickerBtn) {
    clickerBtn.addEventListener('click', onClickerClick);
  }
  if (clickerAmountEl) {
    clickerAmountEl.textContent = '+$' + Game.clickEarning;
  }

  updateBalance();
  updateDropButton();
  renderLastMultipliers();

  if (dropBtn) dropBtn.addEventListener('click', handleDrop);
  if (betInput) {
    betInput.addEventListener('input', onBetInput);
    betInput.addEventListener('change', onBetInput);
  }

  document.querySelectorAll('.btn-risk').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
      const risk = btn.getAttribute('data-risk');
      if (risk === 'low') {
        Game.setPlinkoRiskLevel('low');
        updateRiskLevelUI();
        if (window.Plinko && window.Plinko.updateMultipliers) {
          window.Plinko.updateMultipliers();
        }
        return;
      }
      if (Game.plinkoRiskUnlocked[risk]) {
        Game.setPlinkoRiskLevel(risk);
        updateBalance();
        updateRiskLevelUI();
        if (window.Plinko && window.Plinko.updateMultipliers) {
          window.Plinko.updateMultipliers();
        }
        return;
      }
      if (Game.canUnlockPlinkoRisk(risk)) {
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
  window.showPage = showPage;
  onHashChange();

  setInterval(updateDropButton, 300);
  setInterval(updateRiskLevelUI, 500);
})();

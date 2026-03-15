/**
 * Case Battle: tab page; case management (owner/admin only), create battle (all users), active battles list, join/spectate, add bots.
 */
(function () {
  const API = '/api/case-battle';

  function getAuthHeaders() {
    if (typeof window.Auth !== 'undefined' && typeof window.Auth.getAuthHeaders === 'function') {
      return window.Auth.getAuthHeaders();
    }
    const token = typeof window.Auth !== 'undefined' && window.Auth.getToken ? window.Auth.getToken() : null;
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function isAdminOrOwner() {
    const u = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    return !!(u && (u.isOwner || u.isAdmin || u.role === 'owner' || u.role === 'admin'));
  }

  let casesList = [];
  let battleCasesForCreate = [];
  let pollTimer = null;
  let detailPollInterval = null;
  let currentBattleId = null;
  let lastBattles = [];
  let lastDetailBattle = null;
  let openStripsAnimationRunning = false;
  let jackpotSliderAnimationRunning = false;
  let jackpotRevealShownForBattleId = null;

  const addCustomCaseBtn = document.getElementById('cbAddCustomCaseBtn');
  const addCaseModal = document.getElementById('cbAddCaseModal');
  const addCaseClose = document.getElementById('cbAddCaseClose');
  const caseNameInput = document.getElementById('cbCaseName');
  const rtpInput = document.getElementById('cbRtp');
  const itemsListEl = document.getElementById('cbItemsList');
  const caseCostEl = document.getElementById('cbCaseCost');
  const saveCaseBtn = document.getElementById('cbSaveCase');
  const addItemBtn = document.getElementById('cbAddItem');
  const formatSelect = document.getElementById('cbFormat');
  const modeSelect = document.getElementById('cbMode');
  const crazyModeToggle = document.getElementById('cbCrazyModeToggle');
  const crazyModeRow = document.getElementById('cbCrazyModeRow');
  const battleCasesEl = document.getElementById('cbBattleCases');
  const addCasesBtn = document.getElementById('cbAddCasesBtn');
  const addCasesModal = document.getElementById('cbAddCasesModal');
  const addCasesClose = document.getElementById('cbAddCasesClose');
  const addCasesList = document.getElementById('cbAddCasesList');
  const addCasesSort = document.getElementById('cbCasesSort');
  const entryTotalEl = document.getElementById('cbEntryTotal');
  const createBattleBtn = document.getElementById('cbCreateBattle');
  const battleListEl = document.getElementById('caseBattleList');
  const listView = document.getElementById('cbListView');
  const detailView = document.getElementById('cbDetailView');
  const createBattleModal = document.getElementById('cbCreateBattleModal');
  const createBattleClose = document.getElementById('cbCreateBattleClose');
  const addCasesConfirmBtn = document.getElementById('cbAddCasesConfirmBtn');
  const casesSearchInput = document.getElementById('cbCasesSearch');
  const createNewBtn = document.getElementById('cbCreateNewBtn');
  const detailContent = document.getElementById('cbDetailContent');

  let caseFormItems = [{ name: '', image: '', value: '', probability: '', rarity: 'common' }];
  let editingCaseId = null;
  const editCasesBtn = document.getElementById('cbEditCasesBtn');
  const editCasesModal = document.getElementById('cbEditCasesModal');
  const editCasesClose = document.getElementById('cbEditCasesClose');
  const editCasesListEl = document.getElementById('cbEditCasesList');
  const addCaseTitleEl = document.querySelector('#cbAddCaseModal .cb-add-case-title');

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0);
  }

  function getEffectiveBalance() {
    const user = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    if (window.Game && typeof window.Game.getBalance === 'function') return Number(window.Game.getBalance()) || 0;
    if (window.Game && window.Game.balance != null) return Number(window.Game.balance) || 0;
    return Number(user?.balance) || 0;
  }

  function formatModeDisplay(mode, crazyMode) {
    const m = (mode || '').toLowerCase();
    let label = '';
    if (m === 'standard') label = 'Standard';
    else if (m === 'terminal') label = 'Terminal';
    else if (m === 'coop') label = 'Co-op';
    else if (m === 'jackpot') label = 'Jackpot';
    else label = mode || '';
    if (crazyMode && m !== 'coop') label += ' (Crazy)';
    return label;
  }

  function syncCaseFormFromDom() {
    if (!itemsListEl) return;
    const rows = itemsListEl.querySelectorAll('tr.cb-item-row');
    const next = [];
    rows.forEach((row, i) => {
      const nameEl = row.querySelector('.cb-item-name');
      const imgEl = row.querySelector('.cb-item-image');
      const valEl = row.querySelector('.cb-item-value');
      const pctEl = row.querySelector('.cb-item-pct');
      const rarityEl = row.querySelector('.cb-item-rarity');
      next.push({
        name: (nameEl?.value ?? '').trim(),
        image: (imgEl?.value ?? '').trim(),
        value: valEl?.value !== '' ? String(valEl?.value) : '',
        probability: pctEl?.value !== '' && pctEl?.value != null ? String(pctEl?.value) : '',
        rarity: rarityEl?.value || 'common',
      });
    });
    if (next.length > 0) caseFormItems = next;
  }

  function renderCaseFormItems() {
    if (!itemsListEl) return;
    itemsListEl.innerHTML = caseFormItems
      .map(
        (item, i) =>
          `<tr class="cb-item-row" data-i="${i}">
            <td class="cb-add-case-col-name"><input type="text" class="cb-item-name" data-i="${i}" placeholder="Item name" value="${escapeHtml(item.name)}"></td>
            <td class="cb-add-case-col-image"><input type="text" class="cb-item-image" data-i="${i}" placeholder="https://..." value="${escapeHtml(item.image)}"></td>
            <td class="cb-add-case-col-value"><input type="text" inputmode="decimal" class="cb-item-value" data-i="${i}" placeholder="0.00" value="${item.value !== '' ? item.value : ''}"></td>
            <td class="cb-add-case-col-pct"><input type="text" inputmode="decimal" class="cb-item-pct" data-i="${i}" placeholder="%" value="${item.probability !== '' ? item.probability : ''}"></td>
            <td class="cb-add-case-col-rarity"><select class="cb-item-rarity" data-i="${i}">
              <option value="common"${(item.rarity || 'common') === 'common' ? ' selected' : ''}>Common</option>
              <option value="rare"${item.rarity === 'rare' ? ' selected' : ''}>Rare</option>
              <option value="epic"${item.rarity === 'epic' ? ' selected' : ''}>Epic</option>
              <option value="legendary"${item.rarity === 'legendary' ? ' selected' : ''}>Legendary</option>
            </select></td>
            <td class="cb-add-case-col-remove"><button type="button" class="btn-cb-remove-item" data-i="${i}" aria-label="Remove">×</button></td>
          </tr>`
      )
      .join('');
    itemsListEl.querySelectorAll('.cb-item-name, .cb-item-image, .cb-item-value, .cb-item-pct').forEach((el) => {
      el.addEventListener('input', recalcCaseCost);
      el.addEventListener('change', recalcCaseCost);
    });
    itemsListEl.querySelectorAll('.cb-item-rarity').forEach((el) => {
      el.addEventListener('change', syncCaseFormFromDom);
    });
    itemsListEl.querySelectorAll('.btn-cb-remove-item').forEach((el) => {
      el.addEventListener('click', () => {
        syncCaseFormFromDom();
        const i = parseInt(el.getAttribute('data-i'), 10);
        caseFormItems.splice(i, 1);
        if (caseFormItems.length === 0) caseFormItems = [{ name: '', image: '', value: '', probability: '', rarity: 'common' }];
        renderCaseFormItems();
        recalcCaseCost();
      });
    });
  }

  async function recalcCaseCost() {
    if (!caseCostEl) return;
    const items = caseFormItems.map((row, i) => {
      const name = itemsListEl?.querySelector(`.cb-item-name[data-i="${i}"]`);
      const img = itemsListEl?.querySelector(`.cb-item-image[data-i="${i}"]`);
      const val = itemsListEl?.querySelector(`.cb-item-value[data-i="${i}"]`);
      const pct = itemsListEl?.querySelector(`.cb-item-pct[data-i="${i}"]`);
      return {
        name: name?.value ?? row.name,
        image: img?.value ?? row.image,
        value: Number(val?.value) || 0,
        probability: Number(pct?.value) != null ? Number(pct?.value) : '',
      };
    });
    const rtp = Number(rtpInput?.value) || 95;
    const rtpDec = rtp / 100;
    const normalized = items.map((i) => ({
      value: Number(i.value) || 0,
      probability: Number(i.probability) != null ? Number(i.probability) / 100 : 0,
    }));
    const sumP = normalized.reduce((a, i) => a + i.probability, 0);
    if (normalized.length === 0 || Math.abs(sumP - 1) > 0.0001) {
      caseCostEl.textContent = 'Add items and set probabilities to total 100%';
      caseCostEl.classList.remove('cb-case-cost-ok');
      return;
    }
    try {
      const res = await fetch(API + '/calculate-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ items: normalized.map((n) => ({ value: n.value, probability: n.probability * 100 })), rtpDecimal: rtpDec }),
      });
      const data = await res.json();
      if (data.price != null) {
        caseCostEl.textContent = 'Case cost: ' + formatDollars(data.price) + ' (EV: ' + formatDollars(data.ev) + ')';
        caseCostEl.classList.add('cb-case-cost-ok');
      } else {
        caseCostEl.textContent = data.error || 'Invalid';
        caseCostEl.classList.remove('cb-case-cost-ok');
      }
    } catch (e) {
      caseCostEl.textContent = 'Error calculating';
      caseCostEl.classList.remove('cb-case-cost-ok');
    }
  }

  function updateEntryTotal() {
    if (!entryTotalEl) return;
    let total = 0;
    battleCasesForCreate.forEach(({ caseId, count }) => {
      const c = casesList.find((x) => x.id === caseId);
      if (c) total += c.price * count;
    });
    entryTotalEl.textContent = total > 0 ? 'Entry: ' + formatDollars(total) : '';
  }

  function renderBattleCasesForCreate() {
    if (!battleCasesEl) return;
    battleCasesEl.innerHTML = battleCasesForCreate
      .map(
        (bc, i) => {
          const c = casesList.find((x) => x.id === bc.caseId);
          const name = c ? c.name : bc.caseId;
          return `<div class="cb-battle-case-row">
            <span>${escapeHtml(name)} × ${bc.count}</span>
            <button type="button" class="btn-cb-remove-battle-case" data-i="${i}">×</button>
          </div>`;
        }
      )
      .join('');
    battleCasesEl.querySelectorAll('.btn-cb-remove-battle-case').forEach((el) => {
      el.addEventListener('click', () => {
        battleCasesForCreate.splice(parseInt(el.getAttribute('data-i'), 10), 1);
        renderBattleCasesForCreate();
        updateEntryTotal();
      });
    });
    updateEntryTotal();
  }

  function findCaseById(caseId) {
    if (caseId == null) return null;
    return casesList.find((x) => String(x.id) === String(caseId)) || null;
  }

  function getCaseName(caseId) {
    const c = findCaseById(caseId);
    return c ? c.name : (caseId != null ? String(caseId) : '');
  }

  function getCaseImage(caseId) {
    const c = findCaseById(caseId);
    if (!c || !Array.isArray(c.items) || c.items.length === 0) return '';
    const byValue = c.items.slice().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
    const mostExpensive = byValue[0];
    return (mostExpensive && mostExpensive.image) ? mostExpensive.image : (c.items[0] && c.items[0].image) ? c.items[0].image : '';
  }

  function getCasePrice(caseId) {
    const c = findCaseById(caseId);
    return c && c.price != null ? c.price : 0;
  }

  function participantDisplayName(p) {
    return (p && (p.displayName || p.username)) ? (p.displayName || p.username) : (p && p.username) || '';
  }

  function updateCreateBattleButton(battles) {
    if (!createNewBtn) return;
    const user = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    const username = user?.username || user?.uid || '';
    const hasActive = battles.some((b) =>
      (b.status === 'waiting' || b.status === 'in_progress') &&
      b.participants.some((p) => (p.username === username) && !p.isBot)
    );
    if (hasActive) {
      createNewBtn.disabled = true;
      createNewBtn.title = 'You already have an active battle';
      createNewBtn.classList.add('btn-disabled');
    } else {
      createNewBtn.disabled = false;
      createNewBtn.title = '';
      createNewBtn.classList.remove('btn-disabled');
    }
  }

  function renderBattleList(battles) {
    if (!battleListEl) return;
    const now = Date.now();
    // Hide finished battles 3 seconds after their animation completes on the client
    battles = battles.filter((b) => {
      if (b.status !== 'finished') return true;
      if (!b.animationStartedAt) return !b.finishedAt || now - b.finishedAt < 3000;
      const msPerRound = (b.animationDurationPerRound || 5500) + (b.animationPausePerRound || 500);
      const animDoneAt = b.animationStartedAt + (b.totalRounds || 0) * msPerRound;
      return now < animDoneAt + 3000;
    });
    const user = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    const username = user?.username || user?.uid || '';
    const balance = getEffectiveBalance();
    updateCreateBattleButton(battles);
    if (battles.length === 0) {
      battleListEl.innerHTML = '<p class="case-battle-empty">No active battles. Create one to get started.</p>';
      return;
    }
    battleListEl.innerHTML = battles.map((b) => {
      const filled = b.participants.filter((p) => p.username).length;
      const hasEmpty = filled < b.totalSlots;
      const mySlot = b.participants.find((p) => p.username === username);
      const teamIndices = [...new Set(b.participants.map((p) => p.teamIndex))].sort((a, x) => a - x);
      const sideCount = teamIndices.length;
      const entryEach = b.totalPot / Math.max(1, sideCount);
      const totalCases = (b.cases || []).reduce((s, x) => s + (x.count || 1), 0);
      const isInProgress = b.status === 'in_progress';
      const isWaiting = b.status === 'waiting';
      const mode = (b.mode || 'standard').toLowerCase();
      const modeLabel = formatModeDisplay(b.mode, b.crazyMode);
      const modeCls = b.crazyMode ? 'crazy' : mode;
      // Build by-team map
      const byTeam = {};
      for (const p of b.participants) {
        if (!byTeam[p.teamIndex]) byTeam[p.teamIndex] = [];
        byTeam[p.teamIndex].push(p);
      }
      // Players: team groups with × separators
      const teamGroups = teamIndices.map((ti) => {
        const team = byTeam[ti] || [];
        const avatars = team.map((p) => {
          if (!p.username) {
            return `<span class="cb2-avatar cb2-avatar-empty" title="Empty slot"><span class="cb2-avatar-plus">+</span></span>`;
          }
          const isMe = p.username === username;
          const init = (p.displayName || p.username || '?').charAt(0).toUpperCase();
          return `<span class="cb2-avatar${isMe ? ' cb2-avatar-me' : ''}${p.isBot ? ' cb2-avatar-bot' : ''}" title="${escapeHtml(p.displayName || p.username)}">${init}</span>`;
        }).join('');
        return `<div class="cb2-team">${avatars}</div>`;
      });
      const playersHtml = teamGroups.join('<span class="cb2-vs">×</span>');
      // Cases strip
      const casesHtml = (b.cases || []).map((x) => {
        const img = getCaseImage(x.caseId);
        const name = getCaseName(x.caseId);
        return `<span class="cb2-case" data-case-id="${escapeHtml(String(x.caseId))}" data-battle-id="${escapeHtml(b.id)}" title="${escapeHtml(name)}" role="button" tabindex="0">
          ${img ? `<img src="${escapeHtml(img)}" alt="" onerror="this.style.display='none'">` : `<span class="cb2-case-letter">${escapeHtml((name || '?').charAt(0))}</span>`}
          ${x.count > 1 ? `<span class="cb2-case-cnt">${x.count}</span>` : ''}
        </span>`;
      }).join('');
      // Round / progress label
      const roundLabel = isInProgress && b.currentRound != null && b.totalRounds != null
        ? `Round ${b.currentRound}/${b.totalRounds}`
        : `${totalCases} round${totalCases !== 1 ? 's' : ''}`;
      // Button
      const canJoin = isWaiting && hasEmpty && !mySlot && username;
      const btnLabel = canJoin ? `Join · ${formatDollars(entryEach)}` : (filled >= b.totalSlots || isInProgress ? 'Watch' : 'View');
      return `<div class="cb-card2${mySlot ? ' cb-card2-mine' : ''}" data-id="${escapeHtml(b.id)}" role="button" tabindex="0">
        <div class="cb-card2-modebadge cb-modebadge-${escapeHtml(modeCls)}">${escapeHtml(modeLabel)}</div>
        <div class="cb-card2-players">${playersHtml}</div>
        <div class="cb-card2-cases">${casesHtml}</div>
        <div class="cb-card2-meta">
          <div class="cb-card2-pot">${formatDollars(b.totalPot)}</div>
          <div class="cb-card2-sub">${escapeHtml(roundLabel)} · ${filled}/${b.totalSlots} slots</div>
          ${isInProgress ? '<div class="cb-card2-live">Live</div>' : ''}
          ${mySlot ? '<div class="cb-card2-youin">You\'re in</div>' : ''}
        </div>
        <div class="cb-card2-actions">
          <button type="button" class="cb-card2-btn" data-id="${escapeHtml(b.id)}">${escapeHtml(btnLabel)}</button>
        </div>
      </div>`;
    }).join('');
  }

  function setupBattleListDelegation() {
    if (!battleListEl) return;
    battleListEl.removeEventListener('click', handleBattleListClick);
    battleListEl.addEventListener('click', handleBattleListClick);
    battleListEl.removeEventListener('keydown', handleBattleListKeydown);
    battleListEl.addEventListener('keydown', handleBattleListKeydown);
  }

  function handleBattleListClick(e) {
    // Individual case image click → show case items popup
    const caseEl = e.target.closest('.cb2-case');
    if (caseEl) {
      e.preventDefault();
      e.stopPropagation();
      const caseId = caseEl.getAttribute('data-case-id');
      const battleId = caseEl.getAttribute('data-battle-id');
      const battle = lastBattles.find((b) => b.id === battleId);
      const caseName = getCaseName(caseId);
      const casePrice = getCasePrice(caseId);
      const items = getItemsForCase(caseId, battle);
      showCaseDetailPopup(caseName, casePrice, items);
      return;
    }
    // Watch/Join button
    const btn = e.target.closest('.cb-card2-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      showBattleDetail(btn.getAttribute('data-id'));
      return;
    }
    // Click card body
    const card = e.target.closest('.cb-card2');
    if (card && !e.target.closest('.cb-card2-actions')) {
      showBattleDetail(card.getAttribute('data-id'));
    }
  }

  function handleBattleListKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.cb-card2');
    if (!card) return;
    if (e.target.closest('.cb-card2-actions') || e.target.closest('.cb2-case')) return;
    e.preventDefault();
    showBattleDetail(card.getAttribute('data-id'));
  }

  function getItemsForCase(caseId, battle) {
    if (battle && battle.caseDefs && caseId != null && battle.caseDefs[caseId] && Array.isArray(battle.caseDefs[caseId].items)) {
      return battle.caseDefs[caseId].items;
    }
    const c = findCaseById(caseId);
    return (c && Array.isArray(c.items)) ? c.items : [];
  }

  function openCasesPopover(battleId, anchor) {
    const battle = lastBattles.find((b) => b.id === battleId);
    if (!battle || !battle.cases || battle.cases.length === 0) return;
    openBattleCasesPopup(battle);
  }

  function showListView() {
    currentBattleId = null;
    window.__caseBattleBlockStatsRefresh = false;
    if (window.Game && window.Game.unfreezeBalance) window.Game.unfreezeBalance();
    openStripsAnimationRunning = false;
    jackpotSliderAnimationRunning = false;
    if (detailPollInterval) {
      clearInterval(detailPollInterval);
      detailPollInterval = null;
    }
    if (listView) { listView.classList.remove('hidden'); listView.style.display = ''; }
    if (detailView) { detailView.classList.add('hidden'); detailView.style.display = 'none'; }
    if (window.location.hash.startsWith('#case-battle/')) {
      window.history.replaceState(null, '', '#case-battle');
    }
  }

  async function showBattleDetail(id) {
    if (!id) return;
    currentBattleId = id;
    window.__caseBattleBlockStatsRefresh = true;
    if (window.Game && window.Game.freezeBalance) window.Game.freezeBalance();
    if (listView) { listView.classList.add('hidden'); listView.style.display = 'none'; }
    if (detailView) { detailView.classList.remove('hidden'); detailView.style.display = 'flex'; }
    const newHash = '#case-battle/' + encodeURIComponent(id);
    if (window.location.hash !== newHash) {
      window.history.pushState(null, '', newHash);
    }
    await loadAndRenderDetail(id);
  }

  async function loadAndRenderDetail(id) {
    if (openStripsAnimationRunning || jackpotSliderAnimationRunning) return;
    try {
      const res = await fetch(API + '/battles/' + encodeURIComponent(id), { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok || !data.battle) {
        showListView();
        await loadBattles();
        return;
      }
      const battle = data.battle;
      // Never refresh stats/balance while we are on the battle detail view (any game mode).
      // Balance is updated only when battle is finished AND "Won" / "0$" is visible – from
      // runOpenStripsAnimation (standard/terminal/coop/crazy) or jackpot slider callback (jackpot).
      const skipStatsRefresh = currentBattleId != null;
      if (window.Stats && window.Stats.loadStats && !skipStatsRefresh) await window.Stats.loadStats();
      renderDetailView(battle);
    } catch (e) {
      showListView();
      await loadBattles();
    }
  }

  // --- Deterministic shuffle using server-provided seed ---
  function seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = Math.floor(seed * 2147483647) || 1;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderDetailView(battle) {
    if (!detailContent) return;
    if (detailPollInterval) {
      clearInterval(detailPollInterval);
      detailPollInterval = null;
    }
    const user = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    const username = user?.username || '';
    const balance = getEffectiveBalance();
    const isCreator = battle.createdBy === username;
    const sideCount = new Set(battle.participants.map((p) => p.teamIndex)).size;
    const entryEach = battle.totalPot / Math.max(1, sideCount);
    const hasEmpty = battle.participants.some((p) => !p.username);
    const result = battle.result || {};
    const payoutsBySlot = (result.payouts || []).reduce((acc, p) => {
      acc[p.teamIndex + '_' + p.slotIndex] = p.amount || 0;
      return acc;
    }, {});
    lastDetailBattle = battle;
    const roundCaseList = buildRoundCaseList(battle);
    const totalRounds = roundCaseList.length;
    const roundResults = (result.roundResults) || [];
    const isJackpotMode = (battle.mode || '').toLowerCase() === 'jackpot';
    const jackpotRevealShown = isJackpotMode && jackpotRevealShownForBattleId === battle.id;

    // Server-synced animation state
    let syncedRound = 0;
    let syncedRoundElapsed = 0;
    let isAnimComplete = false;
    const durationPerRound = battle.animationDurationPerRound || 5500;
    const pausePerRound = battle.animationPausePerRound || 800;
    const msPerRound = durationPerRound + pausePerRound;

    if (battle.status === 'finished' && battle.animationStartedAt && totalRounds > 0) {
      const elapsed = Date.now() - battle.animationStartedAt;
      syncedRound = Math.floor(elapsed / msPerRound);
      syncedRoundElapsed = elapsed % msPerRound;
      if (syncedRound >= totalRounds) {
        syncedRound = totalRounds;
        isAnimComplete = true;
      }
    } else if (battle.status === 'finished' && totalRounds > 0) {
      syncedRound = totalRounds;
      isAnimComplete = true;
    }

    // During animation of round R: revealedCount = R (rounds 0..R-1 revealed)
    // During pause after round R's animation: revealedCount = R+1 (round R also revealed)
    const inPausePhase = !isAnimComplete && syncedRoundElapsed >= durationPerRound;
    const revealedCount = isAnimComplete ? totalRounds : (syncedRound + (inPausePhase ? 1 : 0));
    const showJackpotSlider = battle.status === 'finished' && isAnimComplete && isJackpotMode && !jackpotRevealShown;
    const battleFullyFinished = isAnimComplete && !showJackpotSlider;
    const winnerTeamIndex = result.winnerTeamIndex != null ? result.winnerTeamIndex : null;
    const isCoop = (battle.mode || '').toLowerCase() === 'coop';

    // Current round case info
    const currentRoundCase = !isAnimComplete && syncedRound < totalRounds ? roundCaseList[syncedRound] : null;
    const roundLabel = totalRounds > 0 && !isAnimComplete
      ? `Round ${syncedRound + 1} of ${totalRounds}`
      : totalRounds > 0 ? `${totalRounds} rounds` : '';

    // Total display
    let totalDisplay;
    if (battleFullyFinished && result.payouts?.length) {
      totalDisplay = result.payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    } else if (roundResults.length > 0) {
      totalDisplay = roundResults.slice(0, revealedCount).reduce((sum, r) =>
        sum + (r.items || []).reduce((s, it) => s + (Number(it?.value) || 0), 0), 0);
    } else {
      totalDisplay = 0;
    }

    // Round dots
    const dotsHtml = totalRounds > 0 ? Array.from({ length: totalRounds }, (_, i) => {
      const cls = i < revealedCount ? 'completed' : (i === syncedRound && !isAnimComplete ? 'current' : 'pending');
      return `<div class="cb-battle-dot ${cls}"></div>`;
    }).join('') : '';

    // Build header
    const caseDisplayHtml = currentRoundCase
      ? `<div class="cb-battle-case-display" id="cbBattleCaseDisplay" data-case-id="${escapeHtml(currentRoundCase.caseId)}" data-case-name="${escapeHtml(currentRoundCase.name)}" data-case-price="${currentRoundCase.price != null ? currentRoundCase.price : ''}">
          ${currentRoundCase.image ? `<img class="cb-battle-case-img" src="${escapeHtml(currentRoundCase.image)}" alt="" onerror="this.style.display='none'">` : ''}
          <span class="cb-battle-case-name">${escapeHtml(currentRoundCase.name)}</span>
          <span class="cb-battle-case-price">${formatDollars(currentRoundCase.price || 0)}</span>
        </div>` : '';

    const modeLabel = `${escapeHtml(battle.format)} · ${escapeHtml(formatModeDisplay(battle.mode, battle.crazyMode))}`;
    const entryPerSide = battle.entryCostPerSide ?? 0;

    // Actions
    let actionsHtml = '';
    if (isCreator && battle.status === 'waiting') {
      actionsHtml += `<button type="button" class="btn btn-cb-delete-battle" id="cbDeleteBattleBtn">Delete battle</button>`;
    }
    if (battleFullyFinished) {
      actionsHtml += `<button type="button" class="btn btn-cb-remake" id="cbRemakeBtn">Remake</button>`;
    }

    // Build player columns
    const byTeam = groupParticipantsByTeam(battle.participants);
    const format = (battle.format || '1v1').toLowerCase();
    const slotsPerSide = format.split('v').map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
    const useTeamMode = slotsPerSide.some((n) => n > 1);
    const teamIndices = Object.keys(byTeam).map(Number).sort((a, b) => a - b);
    const totalParticipants = battle.participants.length;

    let playersHtml = '';
    let participantIndex = 0;

    if (useTeamMode) {
      // Team mode: grouped columns
      const teamParts = [];
      for (let ti = 0; ti < teamIndices.length; ti++) {
        const team = byTeam[teamIndices[ti]] || [];
        const teamSlotsCount = team.length;
        const cols = team.map((p) => {
          const col = buildPlayerColumn(p, participantIndex++, battle, payoutsBySlot, username, balance, entryEach, revealedCount, battleFullyFinished, winnerTeamIndex, isCoop, isJackpotMode, jackpotRevealShown, roundResults, totalRounds, inPausePhase, syncedRound);
          return col;
        }).join('');
        teamParts.push(`<div class="cb-battle-team-group" data-slots="${teamSlotsCount}">
          <div class="cb-battle-team-label">Team ${teamIndices[ti] + 1}</div>
          <div class="cb-battle-team-cols">${cols}</div>
        </div>`);
      }
      // For multi-player team formats, split into rows to avoid too-narrow columns
      if (teamIndices.length === 4 && slotsPerSide.every((n) => n > 1)) {
        // 2v2v2v2: 2 rows of 2 teams
        const row1 = teamParts.slice(0, 2).join('<div class="cb-battle-team-divider-v"></div>');
        const row2 = teamParts.slice(2, 4).join('<div class="cb-battle-team-divider-v"></div>');
        playersHtml = `<div class="cb-battle-players-wrap"><div class="cb-battle-teams cb-battle-teams-row" data-team-count="2">${row1}</div><div class="cb-battle-team-divider-h"></div><div class="cb-battle-teams cb-battle-teams-row" data-team-count="2">${row2}</div></div>`;
      } else if (teamIndices.length === 3 && slotsPerSide.every((n) => n > 1)) {
        // 2v2v2: 2 teams on top, 1 team full-width on bottom
        const row1 = teamParts.slice(0, 2).join('<div class="cb-battle-team-divider-v"></div>');
        const row2 = teamParts[2];
        playersHtml = `<div class="cb-battle-players-wrap"><div class="cb-battle-teams cb-battle-teams-row" data-team-count="2">${row1}</div><div class="cb-battle-team-divider-h"></div><div class="cb-battle-teams cb-battle-teams-row" data-team-count="1">${row2}</div></div>`;
      } else if (teamIndices.length === 2 && slotsPerSide.every((n) => n > 1)) {
        // 2v2, 3v3: each team on its own row stacked vertically
        playersHtml = `<div class="cb-battle-players-wrap"><div class="cb-battle-teams cb-battle-teams-row" data-team-count="1">${teamParts[0]}</div><div class="cb-battle-team-divider-h"></div><div class="cb-battle-teams cb-battle-teams-row" data-team-count="1">${teamParts[1]}</div></div>`;
      } else {
        playersHtml = `<div class="cb-battle-players cb-battle-teams" data-team-count="${teamIndices.length}">${teamParts.join('<div class="cb-battle-team-divider-v"></div>')}</div>`;
      }
    } else {
      // Solo mode: flat grid
      const cols = [];
      for (let ti = 0; ti < teamIndices.length; ti++) {
        const team = byTeam[teamIndices[ti]] || [];
        for (const p of team) {
          cols.push(buildPlayerColumn(p, participantIndex++, battle, payoutsBySlot, username, balance, entryEach, revealedCount, battleFullyFinished, winnerTeamIndex, isCoop, isJackpotMode, jackpotRevealShown, roundResults, totalRounds, inPausePhase, syncedRound));
        }
      }
      playersHtml = `<div class="cb-battle-players" data-player-count="${totalParticipants}">${cols.join('')}</div>`;
    }

    // Status message
    let statusHtml = '';
    if (battle.status === 'in_progress') {
      statusHtml = '<div class="cb-battle-status-msg opening">Opening cases...</div>';
    } else if (showJackpotSlider) {
      statusHtml = '<div class="cb-battle-jackpot-wrap" id="cbJackpotSliderWrap"><div class="cb-battle-jackpot-label">Jackpot winner</div><div class="cb-jackpot-slider-container" id="cbJackpotSliderContainer"></div></div>';
    }

    // Winner banner
    let winnerBannerHtml = '';
    if (battleFullyFinished && !isCoop && winnerTeamIndex != null) {
      const winners = battle.participants.filter((p) => p.teamIndex === winnerTeamIndex);
      const winnerName = winners.length === 1 ? participantDisplayName(winners[0]) : `Team ${winnerTeamIndex + 1}`;
      const winAmount = (result.payouts || []).filter((p) => p.teamIndex === winnerTeamIndex).reduce((s, p) => s + (p.amount || 0), 0);
      winnerBannerHtml = `<div class="cb-battle-result"><div class="cb-battle-winner-banner"><span class="cb-battle-winner-name">${escapeHtml(winnerName)} wins!</span><span class="cb-battle-winner-amount">${formatDollars(winAmount)}</span></div></div>`;
    } else if (battleFullyFinished && isCoop) {
      const totalPayout = (result.payouts || []).reduce((s, p) => s + (p.amount || 0), 0);
      winnerBannerHtml = `<div class="cb-battle-result"><div class="cb-battle-winner-banner"><span class="cb-battle-winner-name">Co-op split</span><span class="cb-battle-winner-amount">${formatDollars(totalPayout)}</span></div></div>`;
    }

    detailContent.classList.remove('cb-detail-open');
    // Helper: position frozen strips after render (pause phase)
    const _positionFrozenStrips = () => {
      detailContent.querySelectorAll('[data-frozen-stop]').forEach((container) => {
        const stopAt = parseInt(container.getAttribute('data-frozen-stop'), 10);
        const iw = parseInt(container.getAttribute('data-frozen-iw'), 10);
        const strip = container.querySelector('.cb-battle-slider-strip');
        if (!strip) return;
        const containerW = container.offsetWidth;
        const endX = containerW / 2 - (stopAt * iw + iw / 2);
        strip.style.transition = 'none';
        strip.style.transform = 'translateX(' + endX + 'px)';
      });
    };
    detailContent.innerHTML = `
      <div class="cb-battle-header">
        <div class="cb-battle-header-left">
          <button type="button" class="cb-battle-back" id="cbBattleBack">\u2190 All Battles</button>
          <button type="button" class="cb-battle-view-cases-btn" id="cbViewCasesBtn">View cases</button>
        </div>
        <div class="cb-battle-header-center">
          <div class="cb-battle-round-info">
            <span class="cb-battle-round-label">${roundLabel}</span>
            ${caseDisplayHtml}
            ${dotsHtml ? `<div class="cb-battle-round-dots">${dotsHtml}</div>` : ''}
            <div class="cb-battle-mode-label">${modeLabel}${entryPerSide > 0 ? ' · ' + formatDollars(entryPerSide) : ''}</div>
          </div>
        </div>
        <div class="cb-battle-header-right">
          <span class="cb-battle-total">Total: ${formatDollars(totalDisplay)}</span>
          <button type="button" class="cb-battle-share-btn" id="cbShareBtn">Share</button>
        </div>
      </div>
      ${statusHtml}
      ${winnerBannerHtml}
      ${playersHtml}
      ${actionsHtml ? `<div class="cb-battle-actions">${actionsHtml}</div>` : ''}
    `;
    requestAnimationFrame(() => { _positionFrozenStrips(); detailContent.classList.add('cb-detail-open'); });

    // Poll for in_progress battles
    if (battle.status === 'in_progress' && currentBattleId === battle.id) {
      detailPollInterval = setInterval(() => {
        if (currentBattleId) loadAndRenderDetail(currentBattleId);
      }, 1000);
    }
    // Poll during animation (finished but not fully animated yet)
    // IMPORTANT: skip re-render while strip animation is running to avoid destroying the DOM mid-transition
    if (battle.status === 'finished' && !isAnimComplete && currentBattleId === battle.id) {
      detailPollInterval = setInterval(() => {
        if (currentBattleId && !openStripsAnimationRunning) renderDetailView(lastDetailBattle);
      }, 200);
    }

    // Event listeners
    const backBtn = document.getElementById('cbBattleBack');
    if (backBtn) backBtn.addEventListener('click', () => {
      showListView();
      loadBattles();
      if (window.location.hash.startsWith('#case-battle/')) {
        window.history.replaceState(null, '', '#case-battle');
      }
    });
    const deleteBtn = document.getElementById('cbDeleteBattleBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteBattle(battle.id));
    const remakeBtn = document.getElementById('cbRemakeBtn');
    if (remakeBtn) remakeBtn.addEventListener('click', () => remakeBattle(battle));
    const viewCasesBtn = document.getElementById('cbViewCasesBtn');
    if (viewCasesBtn) viewCasesBtn.addEventListener('click', (e) => { e.stopPropagation(); openBattleCasesPopup(battle); });
    const caseDisplayBtn = document.getElementById('cbBattleCaseDisplay');
    if (caseDisplayBtn) {
      caseDisplayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const caseId = caseDisplayBtn.getAttribute('data-case-id');
        const caseName = caseDisplayBtn.getAttribute('data-case-name') || '';
        const casePrice = caseDisplayBtn.getAttribute('data-case-price');
        const priceNum = casePrice === '' || casePrice === null ? null : parseFloat(casePrice);
        const items = getItemsForCase(caseId, battle);
        showCaseDetailPopup(caseName, priceNum, items);
      });
    }
    const shareBtn = document.getElementById('cbShareBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const url = window.location.origin + '/#case-battle/' + encodeURIComponent(battle.id);
        if (navigator.clipboard) navigator.clipboard.writeText(url);
      });
    }
    detailContent.querySelectorAll('.cb-battle-add-bot-btn').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        addBot(el.getAttribute('data-id'), parseInt(el.getAttribute('data-slot'), 10));
      });
    });
    detailContent.querySelectorAll('.cb-battle-join-btn').forEach((el) => {
      if (el.classList.contains('disabled')) return;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        joinBattle(el.getAttribute('data-id'), parseInt(el.getAttribute('data-slot'), 10));
      });
    });

    // Run strip animations for the current synced round (only during animation phase, NOT pause phase)
    if (battle.status === 'finished' && !isAnimComplete && !inPausePhase && syncedRound < totalRounds && roundResults[syncedRound]) {
      // Pre-emptively lock to prevent the 200ms poll interval from re-rendering before the rAF fires
      openStripsAnimationRunning = true;
      requestAnimationFrame(() => {
        runOpenStripsAnimation(battle, syncedRound, syncedRoundElapsed);
      });
    }

    // Jackpot slider
    if (showJackpotSlider) {
      const containerEl = document.getElementById('cbJackpotSliderContainer');
      if (containerEl && winnerTeamIndex != null) {
        if (jackpotSliderAnimationRunning) return;
        jackpotSliderAnimationRunning = true;
        runJackpotSliderAnimation(battle, winnerTeamIndex, containerEl).then(() => {
          jackpotSliderAnimationRunning = false;
          if (!currentBattleId || !lastDetailBattle || lastDetailBattle.id !== currentBattleId) return;
          jackpotRevealShownForBattleId = battle.id;
          renderDetailView(lastDetailBattle);
          unfreezeBalanceAfterBattle(battle);
        });
      } else if (containerEl && winnerTeamIndex == null) {
        jackpotRevealShownForBattleId = battle.id;
        renderDetailView(lastDetailBattle);
      }
    }

    // Unfreeze balance once fully done (non-jackpot)
    if (battleFullyFinished && !isJackpotMode) {
      const userInBattle = battle.participants?.some((p) => {
        if (!user) return false;
        return (p.username || '').toLowerCase() === (username || '').toLowerCase();
      });
      if (userInBattle) unfreezeBalanceAfterBattle(battle);
    }
  }

  function unfreezeBalanceAfterBattle(battle) {
    setTimeout(() => {
      if (!currentBattleId || lastDetailBattle?.id !== currentBattleId) return;
      window.__caseBattleBlockStatsRefresh = false;
      if (window.Game && window.Game.unfreezeBalance) window.Game.unfreezeBalance();
      if (window.Stats && window.Stats.loadStats) {
        window.Stats.loadStats().then(() => {
          if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
          window.__caseBattleBlockStatsRefresh = true;
        }).catch(() => { window.__caseBattleBlockStatsRefresh = true; });
      } else {
        if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
        window.__caseBattleBlockStatsRefresh = true;
      }
    }, 400);
  }

  function buildPlayerColumn(p, pi, battle, payoutsBySlot, username, balance, entryEach, revealedCount, battleFullyFinished, winnerTeamIndex, isCoop, isJackpotMode, jackpotRevealShown, roundResults, totalRounds, inPausePhase, syncedRound) {
    if (!p.username) {
      // Empty slot
      const isCreator = battle.createdBy === username;
      const showJoin = !isCreator && username && battle.status === 'waiting';
      const canAfford = balance >= entryEach;
      return `<div class="cb-battle-player-col empty-col">
        <div class="cb-battle-empty-slot">
          <span>Waiting...</span>
          ${isCreator ? `<button type="button" class="cb-battle-add-bot-btn" data-id="${escapeHtml(battle.id)}" data-slot="${pi}">Add bot</button>` : ''}
          ${showJoin ? (canAfford
            ? `<button type="button" class="cb-battle-join-btn" data-id="${escapeHtml(battle.id)}" data-slot="${pi}">Join for ${formatDollars(entryEach)}</button>`
            : `<button type="button" class="cb-battle-join-btn disabled">Insufficient balance</button>`) : ''}
        </div>
      </div>`;
    }

    const payoutKey = p.teamIndex + '_' + p.slotIndex;
    const payoutAmount = Number(payoutsBySlot[payoutKey]) || 0;
    const isTie = battle.result && battle.result.isTie;
    const isWinner = battleFullyFinished && (isCoop || (isTie ? payoutAmount > 0 : (winnerTeamIndex != null ? p.teamIndex === winnerTeamIndex : payoutAmount > 0)));
    const isLoser = battleFullyFinished && !isWinner && !isCoop;

    // Items revealed so far
    const itemsForParticipant = roundResults.slice(0, revealedCount).map((r) => (r.items && r.items[pi]) ? r.items[pi] : null).filter(Boolean);
    const runningTotal = itemsForParticipant.reduce((s, it) => s + (Number(it.value) || 0), 0);
    const displayTotal = battleFullyFinished ? (p.totalValue != null ? p.totalValue : runningTotal) : runningTotal;

    // Jackpot percentage
    const totalBattleValue = isJackpotMode && revealedCount > 0
      ? roundResults.slice(0, revealedCount).reduce((sum, r) => sum + (r.items || []).reduce((s, it) => s + (Number(it?.value) || 0), 0), 0)
      : 0;
    const jackpotPct = isJackpotMode && totalBattleValue > 0 ? (100 * displayTotal / totalBattleValue).toFixed(1) : '';

    const name = participantDisplayName(p);
    const jackpotTeamClass = isJackpotMode ? ` jackpot-team-${p.teamIndex}` : '';
    const winClass = isWinner ? ' winner' : (isLoser ? ' loser' : '');

    // Items list (newest first)
    const itemsHtml = itemsForParticipant.slice().reverse().map((it, idx) => {
      const isLatest = idx === 0;
      return `<div class="cb-battle-item${isLatest ? ' latest' : ''}">
        ${it.image ? `<img class="cb-battle-item-img" src="${escapeHtml(it.image)}" alt="" onerror="this.style.display='none'">` : `<div class="cb-battle-item-img-placeholder">${escapeHtml((it.name || '').substring(0, 6))}</div>`}
        <div class="cb-battle-item-details">
          <div class="cb-battle-item-name">${escapeHtml(it.name || '')}</div>
          <div class="cb-battle-item-price">${formatDollars(it.value || 0)}</div>
        </div>
      </div>`;
    }).join('');

    // Slider area
    let sliderHtml;
    if (battle.status === 'finished' && !battleFullyFinished && !inPausePhase && roundResults[revealedCount]) {
      // Active animation round - strip will be populated by runOpenStripsAnimation
      sliderHtml = `<div class="cb-battle-slider-wrap"><div class="cb-battle-slider-container"><div class="cb-battle-slider-pointer"></div><div class="cb-battle-slider-strip" id="cbBattleStrip_${pi}"></div></div></div>`;
    } else if (battle.status === 'finished' && !battleFullyFinished && inPausePhase && roundResults[syncedRound]) {
      // Pause phase - show full strip frozen at final position (won item centered under pointer)
      const landedItem = roundResults[syncedRound].items ? roundResults[syncedRound].items[pi] : null;
      const STRIP_REPEAT_P = 25;
      const ITEM_WIDTH_P = 84; // 80px CSS width + 2px margin each side
      const caseDef = (battle.caseDefs || {})[roundResults[syncedRound].caseId];
      const caseItemsP = (caseDef && caseDef.items) || [];
      const sdP = (battle.result && battle.result.stripData && battle.result.stripData[syncedRound] && battle.result.stripData[syncedRound][pi]) || { stripSeed: 0.5, stopOffset: 0.5 };
      if (landedItem && caseItemsP.length > 0) {
        const flatItemsP = [];
        for (let r = 0; r < STRIP_REPEAT_P; r++) {
          const shuffled = seededShuffle(caseItemsP, sdP.stripSeed + r * 0.001);
          for (const k of shuffled) flatItemsP.push(k);
        }
        const landingRepeatP = Math.floor(STRIP_REPEAT_P / 2 - 2);
        const landingBaseP = landingRepeatP * caseItemsP.length;
        const landingOffsetP = Math.floor(sdP.stopOffset * caseItemsP.length);
        const stopAtP = landingBaseP + landingOffsetP;
        flatItemsP[stopAtP] = landedItem;
        const stripItemsHtmlP = flatItemsP.map((it, idx) => {
          const img = it.image ? `<img src="${escapeHtml(it.image)}" alt="">` : `<span class="cb-battle-slider-item-name">${escapeHtml(it.name || '')}</span>`;
          return `<div class="cb-battle-slider-item${idx === stopAtP ? ' landed' : ''}" data-index="${idx}">${img}</div>`;
        }).join('');
        sliderHtml = `<div class="cb-battle-slider-wrap"><div class="cb-battle-slider-container" data-frozen-stop="${stopAtP}" data-frozen-iw="${ITEM_WIDTH_P}"><div class="cb-battle-slider-pointer"></div><div class="cb-battle-slider-strip" style="width:${flatItemsP.length * ITEM_WIDTH_P}px;height:100%">${stripItemsHtmlP}</div></div></div>`;
      } else if (landedItem) {
        const img = landedItem.image ? `<img src="${escapeHtml(landedItem.image)}" alt="">` : `<span>${escapeHtml(landedItem.name || '')}</span>`;
        sliderHtml = `<div class="cb-battle-slider-wrap"><div class="cb-battle-slider-container"><div class="cb-battle-slider-pointer"></div><div class="cb-battle-slider-strip" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%"><div class="cb-battle-slider-item landed" style="width:90px">${img}</div></div></div></div>`;
      } else {
        sliderHtml = `<div class="cb-battle-slider-wrap"><div class="cb-battle-slider-placeholder"></div></div>`;
      }
    } else if (battleFullyFinished) {
      // Show payout result
      const payoutStr = isWinner ? formatDollars(payoutAmount) : '$0';
      const payoutClass = isWinner ? 'win' : 'lose';
      sliderHtml = `<div class="cb-battle-slider-wrap"><div class="cb-battle-slider-placeholder"><span class="cb-battle-player-payout ${payoutClass}">${payoutStr}</span></div></div>`;
    } else {
      sliderHtml = `<div class="cb-battle-slider-wrap"><div class="cb-battle-slider-placeholder"></div></div>`;
    }

    // Value / payout display
    let valueDisplay;
    if (battleFullyFinished) {
      valueDisplay = `<span class="cb-battle-player-payout ${isWinner ? 'win' : 'lose'}">${isWinner ? formatDollars(payoutAmount) : '$0'}</span>`;
    } else {
      valueDisplay = `<span class="cb-battle-player-value">${formatDollars(displayTotal)}</span>`;
    }

    return `<div class="cb-battle-player-col${winClass}${jackpotTeamClass}">
      <div class="cb-battle-player-info">
        <div class="cb-battle-avatar">${name.charAt(0).toUpperCase()}</div>
        <span class="cb-battle-player-name">${escapeHtml(name)}</span>
        ${valueDisplay}
        ${jackpotPct ? `<span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.25rem">${jackpotPct}%</span>` : ''}
      </div>
      ${sliderHtml}
      <div class="cb-battle-items-list">${itemsHtml}</div>
    </div>`;
  }

  function parseTransformX(el) {
    if (!el) return 0;
    const style = window.getComputedStyle(el).transform;
    if (!style || style === 'none') return 0;
    const m = style.match(/matrix\(([^)]+)\)/);
    if (!m) return 0;
    const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
    return parts.length >= 5 ? parts[4] : 0;
  }

  function runOpenStripsAnimation(battle, roundIndex, elapsedInRound) {
    // Note: openStripsAnimationRunning may already be true (pre-set by renderDetailView before rAF)
    const roundResults = (battle.result && battle.result.roundResults) || [];
    const round = roundResults[roundIndex];
    if (!round) { openStripsAnimationRunning = false; return; }
    const caseDef = (battle.caseDefs || {})[round.caseId];
    const caseItems = (caseDef && caseDef.items) || [];
    if (caseItems.length === 0) { openStripsAnimationRunning = false; return; }
    openStripsAnimationRunning = true;
    const STRIP_REPEAT = 25;
    const ITEM_WIDTH = 84; // 80px CSS width + 2px margin each side
    const DURATION_MS = battle.animationDurationPerRound || 5500;
    const items = round.items || [];
    const stripData = (battle.result && battle.result.stripData && battle.result.stripData[roundIndex]) || [];

    // How much time remains if we're joining mid-animation
    const alreadyElapsed = elapsedInRound || 0;
    const remainingMs = Math.max(100, DURATION_MS - alreadyElapsed);
    const isJumpingIn = alreadyElapsed > 500; // joining mid-way

    requestAnimationFrame(() => {
      for (let pi = 0; pi < items.length; pi++) {
        const stripEl = document.getElementById('cbBattleStrip_' + pi);
        if (!stripEl) continue;
        const targetItem = items[pi];
        const sd = stripData[pi] || { stripSeed: Math.random(), stopOffset: Math.random() };

        // Build strip with seeded shuffle
        const flatItems = [];
        for (let r = 0; r < STRIP_REPEAT; r++) {
          const shuffled = seededShuffle(caseItems, sd.stripSeed + r * 0.001);
          for (let k = 0; k < shuffled.length; k++) flatItems.push(shuffled[k]);
        }

        // Place target item at landing position
        const landingRepeat = Math.floor(STRIP_REPEAT / 2 - 2);
        const landingBase = landingRepeat * caseItems.length;
        const landingOffset = Math.floor(sd.stopOffset * caseItems.length);
        const stopAt = landingBase + landingOffset;
        flatItems[stopAt] = targetItem;

        // Stop offset in px
        const offsetPx = (sd.stopOffset - 0.5) * ITEM_WIDTH * 0.6;

        stripEl.innerHTML = flatItems.map((it, idx) => {
          const img = it.image ? `<img src="${escapeHtml(it.image)}" alt="">` : `<span class="cb-battle-slider-item-name">${escapeHtml(it.name || '')}</span>`;
          return `<div class="cb-battle-slider-item" data-index="${idx}">${img}</div>`;
        }).join('');
        stripEl.style.width = (flatItems.length * ITEM_WIDTH) + 'px';

        const containerW = stripEl.parentElement ? stripEl.parentElement.offsetWidth : 280;
        const endX = containerW / 2 - (stopAt * ITEM_WIDTH + ITEM_WIDTH / 2) + offsetPx;

        if (isJumpingIn) {
          // Jump to near the end position with short remaining animation
          stripEl.style.transition = 'none';
          const progress = Math.min(alreadyElapsed / DURATION_MS, 0.95);
          const startX = containerW / 2;
          const jumpX = startX + (endX - startX) * progress;
          stripEl.style.transform = 'translateX(' + jumpX + 'px)';
          stripEl.offsetHeight; // force reflow
          stripEl.style.transition = `transform ${remainingMs}ms cubic-bezier(0.06, 0.65, 0.2, 1)`;
          stripEl.style.transform = 'translateX(' + endX + 'px)';
        } else {
          stripEl.style.transform = 'translateX(0)';
          stripEl.offsetHeight;
          stripEl.style.transition = `transform ${DURATION_MS}ms cubic-bezier(0.06, 0.65, 0.2, 1)`;
          stripEl.style.transform = 'translateX(' + endX + 'px)';
        }
      }
    });

    // Center magnification during animation
    const totalItems = STRIP_REPEAT * caseItems.length;
    const centerInterval = setInterval(() => {
      for (let pi = 0; pi < items.length; pi++) {
        const stripEl = document.getElementById('cbBattleStrip_' + pi);
        if (!stripEl || !stripEl.parentElement) continue;
        const containerW = stripEl.parentElement.offsetWidth;
        const tx = parseTransformX(stripEl);
        const centerPos = -tx + containerW / 2;
        let idx = Math.floor(centerPos / ITEM_WIDTH);
        if (idx < 0) idx = 0;
        if (idx >= totalItems) idx = totalItems - 1;
        stripEl.querySelectorAll('.cb-battle-slider-item.landed').forEach((el) => el.classList.remove('landed'));
        const centered = stripEl.querySelector('.cb-battle-slider-item[data-index="' + idx + '"]');
        if (centered) centered.classList.add('landed');
      }
    }, 50);

    // Animation end - the re-render will be handled by the polling interval in renderDetailView
    const timeToEnd = isJumpingIn ? remainingMs : DURATION_MS;
    setTimeout(() => {
      clearInterval(centerInterval);
      openStripsAnimationRunning = false;
      // Re-render to show next round or final state
      if (currentBattleId && lastDetailBattle && lastDetailBattle.id === currentBattleId) {
        renderDetailView(lastDetailBattle);
      }
    }, timeToEnd + 100);
  }

  function buildRoundCaseList(battle) {
    const list = [];
    for (const { caseId, count } of battle.cases || []) {
      const n = Math.max(1, count || 1);
      const name = getCaseName(caseId);
      const image = getCaseImage(caseId);
      const price = getCasePrice(caseId);
      for (let i = 0; i < n; i++) list.push({ caseId, name, image, price });
    }
    return list;
  }

  function groupParticipantsByTeam(participants) {
    const byTeam = {};
    for (const p of participants || []) {
      const t = p.teamIndex ?? 0;
      if (!byTeam[t]) byTeam[t] = [];
      byTeam[t].push(p);
    }
    return byTeam;
  }

  function getJackpotSliderLabels(battle, byTeam) {
    const format = (battle.format || '1v1').toLowerCase();
    const slotsPerSide = format.split('v').map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
    const useTeamNames = slotsPerSide.length > 0 && slotsPerSide.some((n) => n > 1);
    const teamIndices = Object.keys(byTeam).map(Number).sort((a, b) => a - b);
    return teamIndices.map((ti) => {
      if (useTeamNames) return 'Team ' + (ti + 1);
      const team = byTeam[ti] || [];
      const first = team.find((p) => p.username);
      return first ? participantDisplayName(first) : 'Team ' + (ti + 1);
    });
  }

  function shuffleArray(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const JACKPOT_TEAM_COLORS = [
    'rgba(59, 130, 246, 0.16)',   /* blue */
    'rgba(34, 197, 94, 0.16)',   /* green */
    'rgba(234, 179, 8, 0.16)',   /* amber */
    'rgba(239, 68, 68, 0.16)',   /* red */
    'rgba(168, 85, 247, 0.16)',  /* purple */
  ];

  function runJackpotSliderAnimation(battle, winnerTeamIndex, containerEl) {
    if (!containerEl || winnerTeamIndex == null) return Promise.resolve();
    const byTeam = groupParticipantsByTeam(battle.participants);
    const labels = getJackpotSliderLabels(battle, byTeam);
    if (labels.length === 0) return Promise.resolve();
    const CELL_WIDTH = 100;
    const CELL_GAP = 6;
    const STRIP_REPEAT = 40;
    const flatLabels = [];
    const baseOrder = labels.map((l, i) => ({ label: l, teamIndex: i }));
    for (let r = 0; r < STRIP_REPEAT; r++) {
      const shuffled = shuffleArray([...baseOrder]);
      shuffled.forEach((x) => flatLabels.push(x));
    }
    const winnerIndices = flatLabels.map((x, i) => (x.teamIndex === winnerTeamIndex ? i : -1)).filter((i) => i >= 0);
    const midStart = Math.floor(flatLabels.length * 0.4);
    const stopAt = winnerIndices.find((i) => i >= midStart) ?? winnerIndices[winnerIndices.length - 1] ?? Math.floor(flatLabels.length / 2);
    const stripEl = document.createElement('div');
    stripEl.className = 'cb-jackpot-slider-strip';
    stripEl.innerHTML = flatLabels.map((x, idx) => {
      const color = JACKPOT_TEAM_COLORS[x.teamIndex % JACKPOT_TEAM_COLORS.length];
      return `<div class="cb-jackpot-slider-cell cb-jackpot-slider-cell--team-${x.teamIndex}" data-team="${x.teamIndex}" style="background:${color}">${escapeHtml(x.label)}</div>`;
    }).join('');
    stripEl.style.width = flatLabels.length * (CELL_WIDTH + CELL_GAP) + 'px';
    stripEl.style.transform = 'translateX(0)';
    const viewport = document.createElement('div');
    viewport.className = 'cb-jackpot-slider-viewport';
    viewport.innerHTML = '<div class="cb-jackpot-slider-pointer"></div>';
    viewport.appendChild(stripEl);
    containerEl.innerHTML = '';
    containerEl.appendChild(viewport);
    const viewportWidth = viewport.offsetWidth || 400;
    const DURATION_MS = 5000;
    const baseX = viewportWidth / 2 - (stopAt * (CELL_WIDTH + CELL_GAP) + (CELL_WIDTH + CELL_GAP) / 2);
    stripEl.style.transition = `transform ${DURATION_MS}ms cubic-bezier(0.06, 0.65, 0.2, 1)`;
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          stripEl.style.transform = 'translateX(' + baseX + 'px)';
        });
      });
      setTimeout(() => {
        stripEl.querySelectorAll('.cb-jackpot-slider-cell').forEach((c) => c.classList.remove('cb-jackpot-slider-cell--winner'));
        const winnerCell = stripEl.querySelector(`.cb-jackpot-slider-cell:nth-child(${stopAt + 1})`);
        if (winnerCell) winnerCell.classList.add('cb-jackpot-slider-cell--winner');
        setTimeout(() => resolve(), 2500);
      }, DURATION_MS + 300);
    });
  }

  function openBattleCasesPopover(detailCaseItems, totalPot) {
    const battle = lastDetailBattle;
    if (battle) openBattleCasesPopup(battle);
    else showCasesModal(detailCaseItems || [], totalPot);
  }

  function openBattleCasesPopup(battle) {
    if (!battle || !battle.cases || battle.cases.length === 0) return;
    const byCase = new Map();
    for (const x of battle.cases || []) {
      const caseId = String(x.caseId ?? '');
      const n = Math.max(1, x.count || 1);
      if (!byCase.has(caseId)) {
        byCase.set(caseId, { caseId, name: getCaseName(caseId), image: getCaseImage(caseId), price: getCasePrice(caseId), count: 0 });
      }
      byCase.get(caseId).count += n;
    }
    const casesGrouped = Array.from(byCase.values());
    const totalPot = battle.totalPot || 0;
    const existing = document.getElementById('cbCasesPopover');
    if (existing) existing.remove();
    const pop = document.createElement('div');
    pop.id = 'cbCasesPopover';
    pop.className = 'cb-cases-popover-overlay';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Cases in this battle');
    pop.innerHTML = `
      <div class="cb-cases-popover-backdrop"></div>
      <div class="cb-cases-popover-modal cb-cases-popover-battle">
        <div class="cb-cases-popover-title">Cases in this battle</div>
        <p class="cb-cases-popover-subtitle">Click a case to see contents, price and drop %</p>
        <div class="cb-cases-popover-list">${casesGrouped.map((it) => `
          <div class="cb-cases-popover-item cb-cases-popover-item-clickable" data-case-id="${escapeHtml(it.caseId)}" data-case-name="${escapeHtml(it.name)}" data-case-price="${it.price != null ? it.price : ''}" role="button" tabindex="0">
            ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" class="cb-cases-popover-img" onerror="this.style.display='none'">` : '<div class="cb-cases-popover-img-placeholder">' + escapeHtml((it.name || '').slice(0, 1)) + '</div>'}
            <div class="cb-cases-popover-item-info">
              <span class="cb-cases-popover-name">${escapeHtml(it.name)}${it.count > 1 ? ' × ' + it.count : ''}</span>
              <span class="cb-cases-popover-price">${it.price != null ? formatDollars(it.price) : '—'}</span>
            </div>
          </div>`).join('')}
        </div>
        ${totalPot > 0 ? `<div class="cb-cases-popover-total">Total pot: ${formatDollars(totalPot)}</div>` : ''}
        <button type="button" class="cb-cases-popover-close">Close</button>
      </div>`;
    document.body.appendChild(pop);
    pop.classList.add('cb-cases-popover-enter');
    const close = () => { pop.classList.remove('cb-cases-popover-enter'); pop.classList.add('cb-cases-popover-leave'); setTimeout(() => pop.remove(), 200); };
    pop.querySelector('.cb-cases-popover-close').addEventListener('click', close);
    pop.querySelector('.cb-cases-popover-backdrop').addEventListener('click', close);
    pop.querySelectorAll('.cb-cases-popover-item-clickable').forEach((el) => {
      el.addEventListener('click', () => {
        const caseId = el.getAttribute('data-case-id');
        const caseName = el.getAttribute('data-case-name') || '';
        const casePrice = el.getAttribute('data-case-price');
        const priceNum = casePrice === '' ? null : parseFloat(casePrice);
        const items = getItemsForCase(caseId, battle);
        close();
        showCaseDetailPopup(caseName, priceNum, items);
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    });
  }

  function showCaseDetailPopup(caseName, casePrice, items) {
    const existing = document.getElementById('cbCaseDetailPopover');
    if (existing) existing.remove();
    const sortedItems = (items || []).slice().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
    const itemCards = sortedItems.map((it) => {
      const raw = it.probability != null ? Number(it.probability) : null;
      const pct = raw != null ? (raw < 1 ? raw.toFixed(3) : raw.toFixed(2)) + '%' : '—';
      const val = Number(it.value) || 0;
      const rarity = (it.rarity || 'common').toLowerCase();
      const rarityClass = ['legendary','epic','rare','common'].includes(rarity) ? `rarity-${rarity}` : 'rarity-common';
      return `<div class="cb-cdi-card ${rarityClass}">
        <span class="cb-cdi-prob">${escapeHtml(pct)}</span>
        ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" class="cb-cdi-img" onerror="this.style.display='none'">` : `<div class="cb-cdi-noimg">${escapeHtml((it.name || '').substring(0, 1))}</div>`}
        <div class="cb-cdi-name">${escapeHtml(it.name || '')}</div>
        <div class="cb-cdi-value">${formatDollars(val)}</div>
      </div>`;
    }).join('');
    const pop = document.createElement('div');
    pop.id = 'cbCaseDetailPopover';
    pop.className = 'cb-cases-popover-overlay';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Case contents');
    pop.innerHTML = `
      <div class="cb-cases-popover-backdrop"></div>
      <div class="cb-cdi-modal">
        <div class="cb-cdi-header">
          <div>
            <div class="cb-cdi-title">${escapeHtml(caseName)}</div>
            ${casePrice != null ? `<div class="cb-cdi-price">${formatDollars(casePrice)}</div>` : ''}
          </div>
          <button type="button" class="cb-cdi-close">✕</button>
        </div>
        <div class="cb-cdi-grid">${itemCards || '<p class="cb-case-detail-empty">No items found.</p>'}</div>
      </div>`;
    document.body.appendChild(pop);
    pop.classList.add('cb-cases-popover-enter');
    const close = () => { pop.classList.remove('cb-cases-popover-enter'); pop.classList.add('cb-cases-popover-leave'); setTimeout(() => pop.remove(), 200); };
    pop.querySelector('.cb-cdi-close').addEventListener('click', close);
    pop.querySelector('.cb-cases-popover-backdrop').addEventListener('click', close);
  }

  function showCasesModal(items, totalPot) {
    const existing = document.getElementById('cbCasesPopover');
    if (existing) existing.remove();
    const byKey = new Map();
    for (const it of items || []) {
      const key = (it.caseId != null && it.caseId !== '') ? String(it.caseId) : ((it.name || '') + '\0' + (it.price != null ? it.price : ''));
      const n = Math.max(1, it.count || 1);
      if (!byKey.has(key)) byKey.set(key, { ...it, count: 0 });
      byKey.get(key).count += n;
    }
    const grouped = Array.from(byKey.values());
    const pop = document.createElement('div');
    pop.id = 'cbCasesPopover';
    pop.className = 'cb-cases-popover-overlay';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Cases in this battle');
    const hasPrices = totalPot != null && grouped.some((it) => it.price != null);
    pop.innerHTML = `
      <div class="cb-cases-popover-backdrop"></div>
      <div class="cb-cases-popover-modal cb-cases-popover-battle">
        <div class="cb-cases-popover-title">Cases in this battle</div>
        <div class="cb-cases-popover-list">${grouped.map((it) => `
          <div class="cb-cases-popover-item">
            ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" class="cb-cases-popover-img" onerror="this.style.display='none'">` : ''}
            <div class="cb-cases-popover-item-info">
              <span class="cb-cases-popover-name">${escapeHtml(it.name)}${it.count > 1 ? ' × ' + it.count : ''}</span>
              ${hasPrices && it.price != null ? `<span class="cb-cases-popover-price">${formatDollars(it.price || 0)} each</span>` : ''}
            </div>
          </div>`).join('')}
        </div>
        ${totalPot != null ? `<div class="cb-cases-popover-total">Total: ${formatDollars(totalPot)}</div>` : ''}
        <button type="button" class="cb-cases-popover-close">Close</button>
      </div>`;
    document.body.appendChild(pop);
    pop.classList.add('cb-cases-popover-enter');
    const close = () => { pop.classList.remove('cb-cases-popover-enter'); pop.classList.add('cb-cases-popover-leave'); setTimeout(() => pop.remove(), 200); };
    pop.querySelector('.cb-cases-popover-close').addEventListener('click', close);
    pop.querySelector('.cb-cases-popover-backdrop').addEventListener('click', close);
    pop.addEventListener('click', (ev) => { if (ev.target === pop) close(); });
  }

  async function deleteBattle(id) {
    if (!confirm('Delete this battle and refund all participants?')) return;
    try {
      const res = await fetch(API + '/battles/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to delete');
        return;
      }
      if (window.Game && data.balance != null) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      showListView();
      await loadBattles();
    } catch (e) {
      alert('Network error');
    }
  }

  async function loadCases() {
    try {
      const res = await fetch(API + '/cases', { headers: getAuthHeaders() });
      const data = await res.json();
      casesList = data.cases || [];
      renderAddCasesModalList();
    } catch (e) {
      casesList = [];
    }
  }

  let addCasesTempQueue = []; // ordered array of { caseId, count }
  const addCasesQueueListEl = document.getElementById('cbAddCasesQueueList');
  const addCasesQueueTotalEl = document.getElementById('cbAddCasesQueueTotal');

  function getQueueTotalForCase(caseId) {
    return addCasesTempQueue.filter((e) => String(e.caseId) === String(caseId)).reduce((s, e) => s + e.count, 0);
  }

  function getSortedCases() {
    const sort = addCasesSort?.value || 'price_high_low';
    const list = [...casesList];
    if (sort === 'price_high_low') list.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    else if (sort === 'price_low_high') list.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    else if (sort === 'most_played') list.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
    return list;
  }

  function getFilteredCases() {
    const search = (casesSearchInput?.value || '').toLowerCase().trim();
    let list = getSortedCases();
    if (search) {
      list = list.filter((c) => (c.name || '').toLowerCase().includes(search) || (c.id || '').toString().includes(search));
    }
    return list;
  }

  function updateCaseCountDisplay(caseId) {
    const display = addCasesList?.querySelector(`.cb-add-cases-item-count-display[data-case-id="${caseId}"]`);
    if (display) display.textContent = getQueueTotalForCase(caseId);
  }

  function renderAddCasesModalList() {
    if (!addCasesList) return;
    const filtered = getFilteredCases();
    if (filtered.length === 0) {
      addCasesList.innerHTML = '<p class="cb-add-cases-empty">No cases match. Add a custom case (owner) or try a different search.</p>';
      return;
    }
    addCasesList.innerHTML = filtered
      .map(
        (c) => {
          const usage = c.usageCount ?? 0;
          const count = getQueueTotalForCase(c.id);
          return `<div class="cb-add-cases-item" data-case-id="${escapeHtml(c.id)}">
            <div class="cb-add-cases-item-info" data-case-id="${escapeHtml(c.id)}" role="button" tabindex="0" title="Click to view case contents">
              <div class="cb-add-cases-item-name">${escapeHtml(c.name)}</div>
              <div class="cb-add-cases-item-meta">${formatDollars(c.price)} · Used ${usage}×</div>
            </div>
            <div class="cb-add-cases-item-counter">
              <button type="button" class="cb-add-cases-item-minus" data-case-id="${escapeHtml(c.id)}" aria-label="Decrease">−</button>
              <span class="cb-add-cases-item-count-display" data-case-id="${escapeHtml(c.id)}">${count}</span>
              <button type="button" class="cb-add-cases-item-plus" data-case-id="${escapeHtml(c.id)}" aria-label="Increase">+</button>
            </div>
          </div>`;
        }
      )
      .join('');
    // + button: append to queue (group consecutive same-case clicks)
    addCasesList.querySelectorAll('.cb-add-cases-item-plus').forEach((el) => {
      el.addEventListener('click', () => {
        const caseId = el.getAttribute('data-case-id');
        const last = addCasesTempQueue[addCasesTempQueue.length - 1];
        if (last && String(last.caseId) === String(caseId)) {
          last.count++;
        } else {
          addCasesTempQueue.push({ caseId, count: 1 });
        }
        updateCaseCountDisplay(caseId);
        renderAddCasesQueue();
      });
    });
    // − button: decrement last entry with this caseId
    addCasesList.querySelectorAll('.cb-add-cases-item-minus').forEach((el) => {
      el.addEventListener('click', () => {
        const caseId = el.getAttribute('data-case-id');
        for (let i = addCasesTempQueue.length - 1; i >= 0; i--) {
          if (String(addCasesTempQueue[i].caseId) === String(caseId)) {
            addCasesTempQueue[i].count--;
            if (addCasesTempQueue[i].count <= 0) addCasesTempQueue.splice(i, 1);
            break;
          }
        }
        updateCaseCountDisplay(caseId);
        renderAddCasesQueue();
      });
    });
    // Click case info to show detail popup
    addCasesList.querySelectorAll('.cb-add-cases-item-info').forEach((el) => {
      el.addEventListener('click', () => {
        const caseId = el.getAttribute('data-case-id');
        const c = casesList.find((x) => String(x.id) === String(caseId));
        if (c) showCaseDetailPopup(c.name, c.price, c.items || []);
      });
    });
  }

  function renderAddCasesQueue() {
    if (!addCasesQueueListEl) return;
    if (addCasesTempQueue.length === 0) {
      addCasesQueueListEl.innerHTML = '<p class="cb-add-cases-queue-empty">Click + to add cases</p>';
    } else {
      addCasesQueueListEl.innerHTML = addCasesTempQueue.map((entry, i) => {
        const c = casesList.find((x) => String(x.id) === String(entry.caseId));
        const name = c ? c.name : String(entry.caseId);
        return `<div class="cb-add-cases-queue-row" data-qi="${i}">
          <span class="cb-add-cases-queue-index">${i + 1}.</span>
          <span class="cb-add-cases-queue-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="cb-add-cases-queue-count">×${entry.count}</span>
          <button type="button" class="cb-add-cases-queue-remove" data-qi="${i}" aria-label="Remove">×</button>
        </div>`;
      }).join('');
    }
    // Remove button handler
    addCasesQueueListEl.querySelectorAll('.cb-add-cases-queue-remove').forEach((el) => {
      el.addEventListener('click', () => {
        const qi = parseInt(el.getAttribute('data-qi'), 10);
        const removed = addCasesTempQueue.splice(qi, 1)[0];
        if (removed) updateCaseCountDisplay(removed.caseId);
        renderAddCasesQueue();
      });
    });
    // Update total cost
    if (addCasesQueueTotalEl) {
      let total = 0;
      for (const entry of addCasesTempQueue) {
        const c = casesList.find((x) => String(x.id) === String(entry.caseId));
        if (c) total += (c.price || 0) * entry.count;
      }
      const totalRounds = addCasesTempQueue.reduce((s, e) => s + e.count, 0);
      addCasesQueueTotalEl.innerHTML = addCasesTempQueue.length > 0
        ? `<span>${totalRounds} round${totalRounds !== 1 ? 's' : ''} · ${formatDollars(total)}</span>`
        : '';
    }
  }

  function applyAddCasesAndClose() {
    battleCasesForCreate = addCasesTempQueue.map((e) => ({ caseId: e.caseId, count: e.count }));
    renderBattleCasesForCreate();
    updateEntryTotal();
    closeAddCasesModal();
  }

  function openAddCasesModal() {
    addCasesTempQueue = battleCasesForCreate.map((e) => ({ caseId: e.caseId, count: e.count }));
    loadCases().then(() => {
      if (addCasesModal) {
        addCasesModal.classList.remove('hidden');
        renderAddCasesModalList();
        renderAddCasesQueue();
        casesSearchInput?.focus();
      }
    });
  }

  function closeAddCasesModal() {
    if (addCasesModal) addCasesModal.classList.add('hidden');
  }

  async function loadBattles() {
    if (currentBattleId) return;
    try {
      if (window.Stats && window.Stats.loadStats) await window.Stats.loadStats();
      const res = await fetch(API + '/battles', { headers: getAuthHeaders() });
      const data = await res.json();
      lastBattles = data.battles || [];
      renderBattleList(lastBattles);
    } catch (e) {
      lastBattles = [];
      renderBattleList([]);
    }
  }

  async function saveCase() {
    const name = (caseNameInput?.value || '').trim();
    if (!name) { alert('Enter case name'); return; }
    syncCaseFormFromDom();
    const items = caseFormItems.map((row, i) => {
      const nameEl = itemsListEl?.querySelector(`.cb-item-name[data-i="${i}"]`);
      const img = itemsListEl?.querySelector(`.cb-item-image[data-i="${i}"]`);
      const val = itemsListEl?.querySelector(`.cb-item-value[data-i="${i}"]`);
      const pct = itemsListEl?.querySelector(`.cb-item-pct[data-i="${i}"]`);
      const rar = itemsListEl?.querySelector(`.cb-item-rarity[data-i="${i}"]`);
      return {
        name: (nameEl?.value || '').trim(),
        image: (img?.value || '').trim(),
        value: Number(val?.value) || 0,
        probability: Number(pct?.value) || 0,
        rarity: rar?.value || row.rarity || 'common',
      };
    });
    const rtp = Number(rtpInput?.value) || 96;
    try {
      const url = editingCaseId ? `${API}/cases/${encodeURIComponent(editingCaseId)}` : `${API}/cases`;
      const method = editingCaseId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name, rtpDecimal: rtp / 100, items }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Failed to save case'); return; }
      await loadCases();
      editingCaseId = null;
      caseFormItems = [{ name: '', image: '', value: '', probability: '', rarity: 'common' }];
      renderCaseFormItems();
      if (caseNameInput) caseNameInput.value = '';
      if (caseCostEl) { caseCostEl.textContent = ''; caseCostEl.classList.remove('cb-case-cost-ok'); }
      if (addCaseTitleEl) addCaseTitleEl.textContent = 'Add Custom Case';
      closeAddCaseModal();
    } catch (e) { alert('Network error'); }
  }

  function openAddCaseModal() {
    if (addCaseModal) {
      editingCaseId = null;
      if (addCaseTitleEl) addCaseTitleEl.textContent = 'Add Custom Case';
      caseFormItems = [{ name: '', image: '', value: '', probability: '', rarity: 'common' }];
      renderCaseFormItems();
      if (caseNameInput) caseNameInput.value = '';
      if (caseCostEl) { caseCostEl.textContent = ''; caseCostEl.classList.remove('cb-case-cost-ok'); }
      addCaseModal.classList.remove('hidden');
      caseNameInput?.focus();
    }
  }

  function closeAddCaseModal() {
    if (addCaseModal) addCaseModal.classList.add('hidden');
  }

  function openEditCasesModal() {
    if (!editCasesModal || !editCasesListEl) return;
    const cases = casesList.filter((c) => c.isActive !== false);
    if (cases.length === 0) {
      editCasesListEl.innerHTML = '<p class="cb-edit-cases-empty">No custom cases yet.</p>';
    } else {
      editCasesListEl.innerHTML = cases.map((c) => `
        <div class="cb-edit-case-row" data-id="${escapeHtml(String(c.id))}">
          <div class="cb-edit-case-info">
            <span class="cb-edit-case-name">${escapeHtml(c.name)}</span>
            <span class="cb-edit-case-price">${formatDollars(c.price || 0)}</span>
            <span class="cb-edit-case-items">${(c.items || []).length} items</span>
          </div>
          <div class="cb-edit-case-actions">
            <button type="button" class="cb-edit-case-edit-btn" data-id="${escapeHtml(String(c.id))}">Edit</button>
            <button type="button" class="cb-edit-case-delete-btn" data-id="${escapeHtml(String(c.id))}">Delete</button>
          </div>
        </div>`).join('');
      editCasesListEl.querySelectorAll('.cb-edit-case-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const c = casesList.find((x) => String(x.id) === id);
          if (c) openCaseForEdit(c);
        });
      });
      editCasesListEl.querySelectorAll('.cb-edit-case-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const c = casesList.find((x) => String(x.id) === id);
          if (!c) return;
          if (!confirm(`Delete case "${c.name}"? This cannot be undone.`)) return;
          try {
            const res = await fetch(`${API}/cases/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
            if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to delete'); return; }
            await loadCases();
            openEditCasesModal();
          } catch (e) { alert('Network error'); }
        });
      });
    }
    editCasesModal.classList.remove('hidden');
  }

  function closeEditCasesModal() {
    if (editCasesModal) editCasesModal.classList.add('hidden');
  }

  function openCaseForEdit(c) {
    closeEditCasesModal();
    editingCaseId = String(c.id);
    if (addCaseTitleEl) addCaseTitleEl.textContent = 'Edit Case';
    if (caseNameInput) caseNameInput.value = c.name || '';
    if (rtpInput) rtpInput.value = c.rtpDecimal != null ? Math.round(c.rtpDecimal * 100) : 96;
    caseFormItems = (c.items || []).map((it) => ({
      name: it.name || '',
      image: it.image || '',
      value: it.value != null ? String(it.value) : '',
      probability: it.probability != null ? String(it.probability) : '',
      rarity: it.rarity || 'common',
    }));
    if (caseFormItems.length === 0) caseFormItems = [{ name: '', image: '', value: '', probability: '', rarity: 'common' }];
    renderCaseFormItems();
    if (caseCostEl) { caseCostEl.textContent = ''; caseCostEl.classList.remove('cb-case-cost-ok'); }
    if (addCaseModal) { addCaseModal.classList.remove('hidden'); caseNameInput?.focus(); }
    recalcCaseCost();
  }

  async function createBattle() {
    if (battleCasesForCreate.length === 0) {
      alert('Add at least one case to the battle');
      return;
    }
    const caseIds = battleCasesForCreate.map(({ caseId, count }) => ({ caseId, count }));
    try {
      const res = await fetch(API + '/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          format: formatSelect?.value || '1v1',
          mode: modeSelect?.value || 'standard',
          crazyMode: crazyModeToggle?.classList.contains('is-on') && (modeSelect?.value || 'standard').toLowerCase() !== 'coop',
          caseIds,
          botCount: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to create battle');
        return;
      }
      if (window.Game && data.balance != null) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      battleCasesForCreate = [];
      renderBattleCasesForCreate();
      closeCreateBattleModal();
      if (data.battle && data.battle.id) await showBattleDetail(data.battle.id);
      else await loadBattles();
    } catch (e) {
      alert('Network error');
    }
  }

  async function remakeBattle(battle) {
    if (!battle || !battle.cases || battle.cases.length === 0) return;
    const caseIds = battle.cases.map((x) => ({ caseId: x.caseId, count: x.count || 1 }));
    try {
      const res = await fetch(API + '/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          format: battle.format || '1v1',
          mode: battle.mode || 'standard',
          crazyMode: !!(battle.crazyMode && (battle.mode || 'standard').toLowerCase() !== 'coop'),
          caseIds,
          botCount: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to remake battle');
        return;
      }
      if (window.Game && data.balance != null) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      if (data.battle && data.battle.id) await showBattleDetail(data.battle.id);
      else await loadBattles();
    } catch (e) {
      alert('Network error');
    }
  }

  let joiningBattleId = null;
  async function joinBattle(id, slotIndex) {
    if (joiningBattleId === id) return; // prevent spam clicks
    joiningBattleId = id;
    try {
      const res = await fetch(API + '/battles/' + encodeURIComponent(id) + '/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(slotIndex != null ? { slotIndex } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Cannot join');
        return;
      }
      if (window.Game && data.balance != null) window.Game.balance = data.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      await showBattleDetail(id);
    } catch (e) {
      alert('Network error');
    } finally {
      joiningBattleId = null;
    }
  }

  async function addBot(id, slotIndex) {
    try {
      const res = await fetch(API + '/battles/' + encodeURIComponent(id) + '/add-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(slotIndex != null ? { slotIndex } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Cannot add bot');
        return;
      }
      if (currentBattleId === id) await loadAndRenderDetail(id);
      else await loadBattles();
    } catch (e) {
      alert('Network error');
    }
  }

  function onShow() {
    const adminBtnsEl = document.getElementById('cbAdminBtns');
    if (adminBtnsEl) adminBtnsEl.classList.toggle('hidden', !isAdminOrOwner());
    if (createBattleModal) createBattleModal.classList.add('hidden');
    // Clear any existing poll timer before creating a new one (prevents duplicate timers)
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    loadCases();
    renderCaseFormItems();
    renderBattleCasesForCreate();
    pollTimer = setInterval(() => {
      if (currentBattleId) loadAndRenderDetail(currentBattleId);
      else loadBattles();
    }, 5000);
    const hash = (window.location.hash || '').slice(1);
    if (hash.startsWith('case-battle/')) {
      const battleId = decodeURIComponent(hash.slice('case-battle/'.length));
      if (battleId) {
        showBattleDetail(battleId);
        return;
      }
    }
    // No battle in URL — reset state and show list
    currentBattleId = null;
    openStripsAnimationRunning = false;
    jackpotSliderAnimationRunning = false;
    if (detailPollInterval) { clearInterval(detailPollInterval); detailPollInterval = null; }
    showListView();
    loadBattles();
  }

  function onHide() {
    window.__caseBattleBlockStatsRefresh = false;
    if (window.Game && window.Game.unfreezeBalance) window.Game.unfreezeBalance();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function syncFromHash() {
    const hash = (window.location.hash || '').slice(1);
    if (!hash.startsWith('case-battle/')) return;
    const battleId = decodeURIComponent(hash.slice('case-battle/'.length));
    if (!battleId) return;
    if (currentBattleId !== battleId) {
      showBattleDetail(battleId);
    } else if (detailView && !detailView.classList.contains('hidden')) {
      loadAndRenderDetail(battleId);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const pageEl = document.getElementById('page-case-battle');
      if (pageEl && !pageEl.classList.contains('hidden')) syncFromHash();
    }
  });
  // Browser back/forward is handled by main.js hashchange → onShow()

  if (addItemBtn) addItemBtn.addEventListener('click', () => {
    syncCaseFormFromDom();
    caseFormItems.push({ name: '', image: '', value: '', probability: '', rarity: 'common' });
    renderCaseFormItems();
    recalcCaseCost();
  });
  if (saveCaseBtn) saveCaseBtn.addEventListener('click', saveCase);
  if (createBattleBtn) createBattleBtn.addEventListener('click', createBattle);
  if (addCustomCaseBtn) addCustomCaseBtn.addEventListener('click', openAddCaseModal);
  if (addCaseClose) addCaseClose.addEventListener('click', closeAddCaseModal);
  if (editCasesBtn) editCasesBtn.addEventListener('click', openEditCasesModal);
  if (editCasesClose) editCasesClose.addEventListener('click', closeEditCasesModal);
  if (editCasesModal) {
    const backdrop = editCasesModal.querySelector('.cb-edit-cases-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeEditCasesModal);
  }
  if (addCaseModal) {
    const backdrop = addCaseModal.querySelector('.cb-add-case-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeAddCaseModal);
  }
  if (addCasesBtn) addCasesBtn.addEventListener('click', openAddCasesModal);
  if (addCasesClose) addCasesClose.addEventListener('click', closeAddCasesModal);
  if (addCasesModal) {
    const backdrop = addCasesModal.querySelector('.cb-add-cases-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeAddCasesModal);
  }
  if (addCasesSort) addCasesSort.addEventListener('change', renderAddCasesModalList);
  if (casesSearchInput) casesSearchInput.addEventListener('input', renderAddCasesModalList);
  if (addCasesConfirmBtn) addCasesConfirmBtn.addEventListener('click', applyAddCasesAndClose);
  if (createNewBtn) createNewBtn.addEventListener('click', () => {
    if (createBattleModal) createBattleModal.classList.toggle('hidden');
    updateCrazyModeRow();
  });
  function closeCreateBattleModal() {
    if (createBattleModal) createBattleModal.classList.add('hidden');
  }
  if (createBattleClose) createBattleClose.addEventListener('click', closeCreateBattleModal);
  if (createBattleModal) {
    const backdrop = createBattleModal.querySelector('.cb-create-battle-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeCreateBattleModal);
  }
  function updateCrazyModeRow() {
    const mode = (modeSelect?.value || 'standard').toLowerCase();
    const isCoop = mode === 'coop';
    if (crazyModeRow) crazyModeRow.classList.toggle('hidden', isCoop);
    if (isCoop && crazyModeToggle) {
      crazyModeToggle.classList.remove('is-on');
      crazyModeToggle.setAttribute('aria-checked', 'false');
    }
  }
  if (modeSelect) modeSelect.addEventListener('change', updateCrazyModeRow);
  if (crazyModeToggle) crazyModeToggle.addEventListener('click', () => {
    const mode = (modeSelect?.value || 'standard').toLowerCase();
    if (mode === 'coop') return;
    crazyModeToggle.classList.toggle('is-on');
    crazyModeToggle.setAttribute('aria-checked', crazyModeToggle.classList.contains('is-on'));
  });
  updateCrazyModeRow();
  setupBattleListDelegation();

  window.CaseBattle = { onShow, onHide };
})();

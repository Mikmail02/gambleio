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
  let lastDetailCaseItems = [];
  let lastDetailRoundCaseList = [];
  let currentCaseCarouselIndex = 0;
  let currentReplayRound = 0;
  let lastDetailBattle = null;
  let openStripsAnimationRunning = false;
  let jackpotSliderAnimationRunning = false;
  let jackpotRevealShownForBattleId = null;
  const itemsScrollIndexByKey = {};
  const itemsCountByKey = {};

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
  const backToList = document.getElementById('cbBackToList');
  const detailContent = document.getElementById('cbDetailContent');

  let caseFormItems = [{ name: '', image: '', value: '', probability: '' }];

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0);
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
      next.push({
        name: (nameEl?.value ?? '').trim(),
        image: (imgEl?.value ?? '').trim(),
        value: valEl?.value !== '' ? String(valEl?.value) : '',
        probability: pctEl?.value !== '' && pctEl?.value != null ? String(pctEl?.value) : '',
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
            <td class="cb-add-case-col-name"><input type="text" class="cb-item-name" data-i="${i}" placeholder="Name" value="${escapeHtml(item.name)}"></td>
            <td class="cb-add-case-col-image"><input type="text" class="cb-item-image" data-i="${i}" placeholder="https://..." value="${escapeHtml(item.image)}"></td>
            <td class="cb-add-case-col-value"><input type="number" class="cb-item-value" data-i="${i}" placeholder="0" min="0" step="0.01" value="${item.value !== '' ? item.value : ''}"></td>
            <td class="cb-add-case-col-pct"><input type="number" class="cb-item-pct" data-i="${i}" placeholder="%" min="0" max="100" step="0.01" value="${item.probability !== '' ? item.probability : ''}"></td>
            <td class="cb-add-case-col-remove"><button type="button" class="btn-cb-remove-item" data-i="${i}" aria-label="Remove">×</button></td>
          </tr>`
      )
      .join('');
    itemsListEl.querySelectorAll('.cb-item-name, .cb-item-image, .cb-item-value, .cb-item-pct').forEach((el) => {
      el.addEventListener('input', recalcCaseCost);
      el.addEventListener('change', recalcCaseCost);
    });
    itemsListEl.querySelectorAll('.btn-cb-remove-item').forEach((el) => {
      el.addEventListener('click', () => {
        syncCaseFormFromDom();
        const i = parseInt(el.getAttribute('data-i'), 10);
        caseFormItems.splice(i, 1);
        if (caseFormItems.length === 0) caseFormItems = [{ name: '', image: '', value: '', probability: '' }];
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

  function getCaseName(caseId) {
    const c = casesList.find((x) => x.id === caseId);
    return c ? c.name : caseId;
  }

  function getCaseImage(caseId) {
    const c = casesList.find((x) => x.id === caseId);
    const first = c && Array.isArray(c.items) && c.items.length > 0 ? c.items[0] : null;
    return (first && first.image) ? first.image : '';
  }

  function getCasePrice(caseId) {
    const c = casesList.find((x) => x.id === caseId);
    return c && c.price != null ? c.price : 0;
  }

  function participantDisplayName(p) {
    return (p && (p.displayName || p.username)) ? (p.displayName || p.username) : (p && p.username) || '';
  }

  function renderBattleList(battles) {
    if (!battleListEl) return;
    const user = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    const username = user?.username || '';
    const balance = user?.balance ?? 0;
    battleListEl.innerHTML = battles.length === 0
      ? '<p class="case-battle-empty">No active battles. Click "Create battle" to start one.</p>'
      : battles
          .map((b) => {
            const filled = b.participants.filter((p) => p.username).length;
            const hasEmpty = filled < b.totalSlots;
            const mySlot = b.participants.find((p) => p.username === username);
            const sideCount = new Set(b.participants.map((p) => p.teamIndex)).size;
            const entryEach = b.totalPot / Math.max(1, sideCount);
            const totalCases = (b.cases || []).reduce((sum, x) => sum + (x.count || 1), 0);
            const battleCases = b.cases || [];
            const caseThumbs = battleCases.map((x) => {
              const img = getCaseImage(x.caseId);
              const name = getCaseName(x.caseId);
              const label = x.count > 1 ? name + ' ×' + x.count : name;
              return img
                ? `<span class="cb-card-case-thumb" title="${escapeHtml(label)}"><img src="${escapeHtml(img)}" alt="" onerror="this.style.display='none'"></span>`
                : `<span class="cb-card-case-pill" title="${escapeHtml(label)}">${escapeHtml(name)}${x.count > 1 ? ' ×' + x.count : ''}</span>`;
            }).slice(0, 8);
            const canAfford = balance >= entryEach;
            const joinBtn = hasEmpty && username && !mySlot
              ? (canAfford
                ? `<button type="button" class="btn btn-cb-join" data-id="${escapeHtml(b.id)}">Join for ${formatDollars(entryEach)}</button>`
                : `<button type="button" class="btn btn-cb-join-disabled" disabled>Join for ${formatDollars(entryEach)}</button>`)
              : '';
            const watchBtn = `<button type="button" class="btn btn-cb-watch" data-id="${escapeHtml(b.id)}">${filled >= b.totalSlots ? 'Watch' : 'View'}</button>`;
            return `<div class="case-battle-card" data-id="${escapeHtml(b.id)}" role="button" tabindex="0">
              <div class="cb-card-cases">${caseThumbs.join('')}</div>
              <button type="button" class="cb-card-cases-btn" data-id="${escapeHtml(b.id)}" title="View cases in this battle">Cases (${totalCases})</button>
              <div class="cb-card-meta">
                <div class="cb-card-top-row">
                  <span class="cb-card-total-cases">${totalCases} cases</span>
                  <span class="cb-card-pot">${formatDollars(b.totalPot)}</span>
                </div>
                <div class="cb-card-format-mode">${escapeHtml(b.format)} · ${escapeHtml(formatModeDisplay(b.mode, b.crazyMode))}</div>
                <div class="cb-card-slots-row">
                  <div class="cb-card-slots">${b.participants.map((p) => `<span class="cb-card-slot ${p.username ? 'filled' : ''}">${p.username ? '✓' : ''}</span>`).join('')}</div>
                  ${hasEmpty ? `<span class="cb-card-waiting">${filled}/${b.totalSlots} slots</span>` : ''}
                </div>
              </div>
              <div class="cb-card-actions" onclick="event.stopPropagation()">
                ${mySlot ? '<span class="cb-you-in">You are in</span>' : ''}
                ${joinBtn}
                ${watchBtn}
              </div>
            </div>`;
          })
          .join('');
  }

  function setupBattleListDelegation() {
    if (!battleListEl) return;
    battleListEl.removeEventListener('click', handleBattleListClick);
    battleListEl.addEventListener('click', handleBattleListClick);
    battleListEl.removeEventListener('keydown', handleBattleListKeydown);
    battleListEl.addEventListener('keydown', handleBattleListKeydown);
  }

  function handleBattleListClick(e) {
    const card = e.target.closest('.case-battle-card');
    if (!card) return;
    const id = card.getAttribute('data-id');
    if (e.target.closest('.btn-cb-join')) {
      e.preventDefault();
      e.stopPropagation();
      joinBattle(id);
      return;
    }
    if (e.target.closest('.btn-cb-watch')) {
      e.preventDefault();
      e.stopPropagation();
      showBattleDetail(id);
      return;
    }
    if (e.target.closest('.cb-card-cases-btn')) {
      e.preventDefault();
      e.stopPropagation();
      openCasesPopover(id, e.target);
      return;
    }
    if (!e.target.closest('.cb-card-actions')) {
      showBattleDetail(id);
    }
  }

  function handleBattleListKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.case-battle-card');
    if (!card) return;
    if (e.target.closest('.cb-card-actions') || e.target.closest('.cb-card-cases-btn')) return;
    e.preventDefault();
    showBattleDetail(card.getAttribute('data-id'));
  }

  function openCasesPopover(battleId, anchor) {
    const battle = lastBattles.find((b) => b.id === battleId);
    if (!battle || !battle.cases || battle.cases.length === 0) return;
    const items = battle.cases.map((x) => ({
      name: getCaseName(x.caseId),
      count: x.count || 1,
      image: getCaseImage(x.caseId),
    }));
    showCasesModal(items, null);
  }

  function showListView() {
    currentBattleId = null;
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
    if (id !== currentBattleId) currentReplayRound = 0;
    currentBattleId = id;
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
      renderDetailView(data.battle);
    } catch (e) {
      showListView();
      await loadBattles();
    }
  }

  function renderDetailView(battle) {
    if (!detailContent) return;
    if (detailPollInterval) {
      clearInterval(detailPollInterval);
      detailPollInterval = null;
    }
    const user = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    const username = user?.username || '';
    const balance = user?.balance ?? 0;
    const isCreator = battle.createdBy === username;
    const sideCount = new Set(battle.participants.map((p) => p.teamIndex)).size;
    const entryEach = battle.totalPot / Math.max(1, sideCount);
    const canAfford = balance >= entryEach;
    const mySlot = battle.participants.find((p) => p.username === username);
    const hasEmpty = battle.participants.some((p) => !p.username);
    const result = battle.result || {};
    const payoutsBySlot = (result.payouts || []).reduce((acc, p) => {
      const key = p.teamIndex + '_' + p.slotIndex;
      acc[key] = p.amount || 0;
      return acc;
    }, {});
    let actionsHtml = '';
    if (!mySlot && hasEmpty) {
      actionsHtml += canAfford
        ? `<button type="button" class="btn btn-cb-join-detail" id="cbDetailJoinBtn">Join for ${formatDollars(entryEach)}</button>`
        : `<button type="button" class="btn btn-cb-join-detail disabled" disabled>Join for ${formatDollars(entryEach)} (insufficient balance)</button>`;
    }
    if (isCreator && battle.status === 'waiting') {
      actionsHtml += `<button type="button" class="btn btn-cb-delete-battle" id="cbDeleteBattleBtn">Delete battle</button>`;
    }
    const detailCaseItems = (battle.cases || []).map((x) => ({
      name: getCaseName(x.caseId),
      count: x.count || 1,
      image: getCaseImage(x.caseId),
      price: getCasePrice(x.caseId),
    }));
    lastDetailCaseItems = detailCaseItems;
    lastDetailBattle = battle;
    const roundCaseList = buildRoundCaseList(battle);
    lastDetailRoundCaseList = roundCaseList;
    const totalRounds = roundCaseList.length;
    if (battle.status === 'finished' && (battle.result && battle.result.roundResults)) {
      currentReplayRound = Math.min(currentReplayRound, totalRounds);
      currentCaseCarouselIndex = currentReplayRound;
    } else {
      if (totalRounds === 0) currentCaseCarouselIndex = 0;
      else currentCaseCarouselIndex = Math.min(currentCaseCarouselIndex, totalRounds - 1);
    }
    const isFullyRevealed = battle.status === 'finished' && currentCaseCarouselIndex >= totalRounds;
    const roundLabel = totalRounds > 0 && !isFullyRevealed
      ? `Round ${currentCaseCarouselIndex + 1}/${totalRounds}`
      : totalRounds > 0 ? `${totalRounds} rounds` : '—';
    const roundCaseName = totalRounds > 0 && !isFullyRevealed && roundCaseList[currentCaseCarouselIndex]
      ? escapeHtml(roundCaseList[currentCaseCarouselIndex].name) : '';
    const roundCasePrice = totalRounds > 0 && !isFullyRevealed && roundCaseList[currentCaseCarouselIndex] && roundCaseList[currentCaseCarouselIndex].price != null
      ? formatDollars(roundCaseList[currentCaseCarouselIndex].price) : '';
    const isJackpotMode = (battle.mode || '').toLowerCase() === 'jackpot';
    const jackpotRevealShown = isJackpotMode && jackpotRevealShownForBattleId === battle.id;
    const showJackpotSlider = battle.status === 'finished' && isFullyRevealed && isJackpotMode && !jackpotRevealShown;
    const openingMsg = battle.status === 'in_progress' ? '<div class="cb-detail-opening-msg">Opening cases…</div>' : '';
    const finishedMsg = battle.status === 'finished' && isFullyRevealed && !showJackpotSlider ? '<div class="cb-detail-finished-msg">Battle finished</div>' : '';
    const jackpotSliderHtml = showJackpotSlider ? '<div class="cb-jackpot-slider-wrap" id="cbJackpotSliderWrap"><div class="cb-jackpot-slider-label">Jackpot winner</div><div class="cb-jackpot-slider-container" id="cbJackpotSliderContainer"></div></div>' : '';
    const byTeam = groupParticipantsByTeam(battle.participants);
    const slotsHtmlGrouped = buildSlotsGroupedByTeam(byTeam, battle, payoutsBySlot, username, currentCaseCarouselIndex);
    const roundResults = (battle.result && battle.result.roundResults) || [];
    let totalDisplay;
    if (battle.status === 'finished' && isFullyRevealed && (battle.result?.payouts?.length)) {
      totalDisplay = battle.result.payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    } else if (roundResults.length > 0) {
      const revealedCount = isFullyRevealed ? roundResults.length : currentCaseCarouselIndex;
      totalDisplay = roundResults.slice(0, revealedCount).reduce((sum, r) => {
        return sum + (r.items || []).reduce((s, it) => s + (Number(it?.value) || 0), 0);
      }, 0);
    } else {
      totalDisplay = 0;
    }
    const entryPerSide = battle.entryCostPerSide ?? 0;
    const entryCostStr = entryPerSide > 0 ? formatDollars(entryPerSide) : '';
    detailContent.classList.remove('cb-detail-open');
    const remakeBtnHtml = (battle.status === 'finished' && isFullyRevealed)
      ? `<button type="button" class="btn btn-cb-remake" id="cbRemakeBtn">Remake</button>`
      : '';
    detailContent.innerHTML = `
      <div class="cb-detail-top">
        <h3 class="cb-detail-title">${escapeHtml(battle.format)} · ${escapeHtml(formatModeDisplay(battle.mode, battle.crazyMode))}${entryCostStr ? ' · ' + entryCostStr : ''}</h3>
        ${remakeBtnHtml}
        <div class="cb-detail-total">Total: ${formatDollars(totalDisplay)}</div>
      </div>
      <div class="cb-detail-round-bar" id="cbDetailRoundBar">
        <span class="cb-round-bar-label">${roundLabel}</span>
        ${roundCaseName ? `<span class="cb-round-bar-sep">|</span><span class="cb-round-bar-case">${roundCaseName}</span>` : ''}
        ${roundCasePrice ? `<span class="cb-round-bar-sep">|</span><span class="cb-round-bar-price">${roundCasePrice}</span>` : ''}
      </div>
      <div class="cb-detail-main-layout">
        <div class="cb-detail-slots-column">
          <div class="cb-detail-slots-header">
            <h4 class="cb-detail-slots-title">Slots (${battle.participants.filter((p) => p.username).length}/${battle.totalSlots})</h4>
            <button type="button" class="btn-cb-view-cases" id="cbViewCasesBtn">View cases</button>
          </div>
          <div class="cb-detail-slots-grouped">${slotsHtmlGrouped}</div>
        </div>
        <div class="cb-detail-open-column">
          ${openingMsg}
          ${finishedMsg}
          ${jackpotSliderHtml}
        </div>
      </div>
      <div class="cb-detail-actions">${actionsHtml}</div>
    `;
    requestAnimationFrame(() => { detailContent.classList.add('cb-detail-open'); });
    if (battle.status === 'in_progress' && currentBattleId === battle.id) {
      detailPollInterval = setInterval(() => {
        if (currentBattleId) loadAndRenderDetail(currentBattleId);
      }, 1000);
    }
    if (battle.status === 'finished' && battle.participants.some((p) => p.username === username)) {
      if (!isJackpotMode || jackpotRevealShown) {
        if (window.Stats && window.Stats.loadStats) {
          window.Stats.loadStats().then(() => {
            if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
          });
        } else if (window.Auth && window.Auth.updateBalance) {
          window.Auth.updateBalance();
        }
      }
    }
    detailContent.querySelectorAll('.cb-detail-slot-add-bot').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = el.getAttribute('data-slot');
        addBot(el.getAttribute('data-id'), slot != null ? parseInt(slot, 10) : undefined);
      });
    });
    const joinBtn = document.getElementById('cbDetailJoinBtn');
    if (joinBtn) joinBtn.addEventListener('click', () => joinBattle(battle.id));
    const deleteBtn = document.getElementById('cbDeleteBattleBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteBattle(battle.id));
    const remakeBtn = document.getElementById('cbRemakeBtn');
    if (remakeBtn) remakeBtn.addEventListener('click', () => remakeBattle(battle));
    const viewCasesBtn = document.getElementById('cbViewCasesBtn');
    const openCasesModal = () => openBattleCasesPopover(detailCaseItems, battle.totalPot);
    if (viewCasesBtn) viewCasesBtn.addEventListener('click', (e) => { e.stopPropagation(); openCasesModal(); });
    detailContent.querySelectorAll('.cb-detail-items-scroll-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const bid = btn.getAttribute('data-battle-id');
        const pi = parseInt(btn.getAttribute('data-pi'), 10);
        const dir = parseInt(btn.getAttribute('data-dir'), 10) || 1;
        const key = `${bid}_${pi}`;
        const roundResults = (lastDetailBattle && lastDetailBattle.result && lastDetailBattle.result.roundResults) || [];
        const itemsCount = roundResults.filter((r) => r.items && r.items[pi]).length;
        const maxScroll = Math.max(0, itemsCount - 5);
        let scrollIndex = (itemsScrollIndexByKey[key] ?? 0) + dir * 5;
        scrollIndex = Math.min(Math.max(0, scrollIndex), maxScroll);
        itemsScrollIndexByKey[key] = scrollIndex;
        updateItemsColumnOnly(lastDetailBattle, pi);
      });
    });
    if (battle.status === 'finished' && (battle.result && battle.result.roundResults && battle.result.roundResults.length > 0)) {
      requestAnimationFrame(() => { runOpenStripsAnimation(battle, currentCaseCarouselIndex); });
    }
    if (showJackpotSlider) {
      const winnerTeamIndex = battle.result && battle.result.winnerTeamIndex != null ? battle.result.winnerTeamIndex : null;
      const containerEl = document.getElementById('cbJackpotSliderContainer');
      if (containerEl && winnerTeamIndex != null) {
        if (jackpotSliderAnimationRunning) return;
        jackpotSliderAnimationRunning = true;
        runJackpotSliderAnimation(battle, winnerTeamIndex, containerEl).then(() => {
          jackpotSliderAnimationRunning = false;
          if (!currentBattleId || !lastDetailBattle || lastDetailBattle.id !== currentBattleId) return;
          jackpotRevealShownForBattleId = battle.id;
          renderDetailView(lastDetailBattle);
        });
      } else if (containerEl && winnerTeamIndex == null) {
        jackpotRevealShownForBattleId = battle.id;
        renderDetailView(lastDetailBattle);
      }
    }
  }

  function updateItemsColumnOnly(battle, pi) {
    if (!battle || !detailContent) return;
    const roundResults = (battle.result && battle.result.roundResults) || [];
    const totalRounds = roundResults.length;
    const replayInProgress = battle.status === 'finished' && totalRounds > 0 && currentCaseCarouselIndex < totalRounds;
    const revealedCount = replayInProgress ? currentCaseCarouselIndex : totalRounds;
    const itemsForParticipant = roundResults.slice(0, revealedCount).map((r) => (r.items && r.items[pi]) ? r.items[pi] : null).filter(Boolean);
    const itemsDisplayOrder = itemsForParticipant;
    const itemsCount = itemsDisplayOrder.length;
    const scrollKey = `${battle.id}_${pi}`;
    const maxScroll = Math.max(0, itemsCount - 5);
    let scrollIndex = itemsScrollIndexByKey[scrollKey] ?? maxScroll;
    scrollIndex = Math.min(Math.max(0, scrollIndex), maxScroll);
    itemsScrollIndexByKey[scrollKey] = scrollIndex;
    const visibleItems = itemsDisplayOrder.slice(scrollIndex, scrollIndex + 5);
    const showArrows = itemsCount > 5;
    const canScrollLeft = scrollIndex > 0;
    const canScrollRight = scrollIndex < maxScroll;
    const html = `${showArrows ? `<button type="button" class="cb-detail-items-scroll-btn cb-detail-items-scroll-left" data-pi="${pi}" data-battle-id="${escapeHtml(battle.id)}" data-dir="-1" ${!canScrollLeft ? 'disabled' : ''} aria-label="Previous items">‹</button>` : ''}
      <div class="cb-detail-items-row">
        ${visibleItems.map((it) => `
        <div class="cb-detail-item-card">
          ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" class="cb-detail-item-card-img" onerror="this.style.display='none'">` : '<div class="cb-detail-item-card-placeholder">' + escapeHtml(it.name || '') + '</div>'}
          <div class="cb-detail-item-card-price">${formatDollars(it.value || 0)}</div>
        </div>`).join('')}
      </div>
      ${showArrows ? `<button type="button" class="cb-detail-items-scroll-btn cb-detail-items-scroll-right" data-pi="${pi}" data-battle-id="${escapeHtml(battle.id)}" data-dir="1" ${!canScrollRight ? 'disabled' : ''} aria-label="Next items">›</button>` : ''}`;
    const cols = detailContent.querySelectorAll('.cb-detail-items-column');
    const col = cols[pi];
    if (col) {
      col.innerHTML = html;
      col.querySelectorAll('.cb-detail-items-scroll-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.disabled) return;
          const bid = btn.getAttribute('data-battle-id');
          const p = parseInt(btn.getAttribute('data-pi'), 10);
          const dir = parseInt(btn.getAttribute('data-dir'), 10) || 1;
          const key = `${bid}_${p}`;
          const rr = (lastDetailBattle && lastDetailBattle.result && lastDetailBattle.result.roundResults) || [];
          const count = rr.filter((r) => r.items && r.items[p]).length;
          const max = Math.max(0, count - 5);
          let idx = (itemsScrollIndexByKey[key] ?? 0) + dir * 5;
          idx = Math.min(Math.max(0, idx), max);
          itemsScrollIndexByKey[key] = idx;
          updateItemsColumnOnly(lastDetailBattle, p);
        });
      });
    }
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

  function runOpenStripsAnimation(battle, roundIndex) {
    if (openStripsAnimationRunning) return;
    const roundResults = (battle.result && battle.result.roundResults) || [];
    const round = roundResults[roundIndex];
    if (!round) return;
    const caseDef = (battle.caseDefs || {})[round.caseId];
    const caseItems = (caseDef && caseDef.items) || [];
    if (caseItems.length === 0) return;
    openStripsAnimationRunning = true;
    const STRIP_REPEAT = 25;
    const ITEM_WIDTH = 56;
    const DURATION_MS = 5500;
    const SETTLE_MS = 220;
    const PAUSE_AFTER_LAND_MS = 150;
    const items = round.items || [];
    const stopAts = [];
    const offsetPx = [];
    for (let pi = 0; pi < items.length; pi++) {
      const o = (Math.random() - 0.5) * ITEM_WIDTH * 0.7;
      offsetPx[pi] = o;
    }
    requestAnimationFrame(() => {
      for (let pi = 0; pi < items.length; pi++) {
        const stripEl = document.getElementById('cbOpenStrip_' + pi);
        if (!stripEl) continue;
        const targetItem = items[pi];
        const flatItems = [];
        for (let r = 0; r < STRIP_REPEAT; r++) {
          for (let k = 0; k < caseItems.length; k++) flatItems.push(caseItems[k]);
        }
        let targetIdxInCase = -1;
        for (let k = 0; k < caseItems.length; k++) {
          const it = caseItems[k];
          if (Number(it.value) === Number(targetItem.value) && (it.name || '') === (targetItem.name || '')) {
            targetIdxInCase = k;
            break;
          }
        }
        if (targetIdxInCase < 0) targetIdxInCase = 0;
        const stopAt = Math.floor(STRIP_REPEAT / 2 - 2) * caseItems.length + targetIdxInCase;
        stopAts[pi] = stopAt;
        stripEl.innerHTML = flatItems.map((it, idx) => {
          const img = it.image ? `<img src="${escapeHtml(it.image)}" alt="">` : `<span class="cb-open-strip-item-name">${escapeHtml(it.name || '')}</span>`;
          return `<div class="cb-open-strip-item" data-index="${idx}" style="width:${ITEM_WIDTH}px">${img}</div>`;
        }).join('');
        stripEl.style.width = (flatItems.length * ITEM_WIDTH) + 'px';
        stripEl.style.transform = 'translateX(0)';
        stripEl.offsetHeight;
        const containerW = stripEl.parentElement ? stripEl.parentElement.offsetWidth : 280;
        const baseX = containerW / 2 - (stopAt * ITEM_WIDTH + ITEM_WIDTH / 2);
        const endX = baseX + (offsetPx[pi] || 0);
        stripEl.style.transition = `transform ${DURATION_MS}ms cubic-bezier(0.06, 0.65, 0.2, 1)`;
        stripEl.style.transform = 'translateX(' + endX + 'px)';
      }
    });
    const totalItems = STRIP_REPEAT * caseItems.length;
    const updateCenterMagnification = () => {
      for (let pi = 0; pi < items.length; pi++) {
        const stripEl = document.getElementById('cbOpenStrip_' + pi);
        if (!stripEl || !stripEl.parentElement) continue;
        const containerW = stripEl.parentElement.offsetWidth;
        const tx = parseTransformX(stripEl);
        const centerPos = -tx + containerW / 2;
        let idx = Math.floor(centerPos / ITEM_WIDTH);
        if (idx < 0) idx = 0;
        if (idx >= totalItems) idx = totalItems - 1;
        stripEl.querySelectorAll('.cb-open-strip-item-centered').forEach((el) => el.classList.remove('cb-open-strip-item-centered'));
        const centered = stripEl.querySelector('.cb-open-strip-item[data-index="' + idx + '"]');
        if (centered) centered.classList.add('cb-open-strip-item-centered');
      }
    };
    const centerInterval = setInterval(updateCenterMagnification, 50);
    const onMainAnimationEnd = async () => {
      clearInterval(centerInterval);
      for (let pi = 0; pi < items.length; pi++) {
        const stripEl = document.getElementById('cbOpenStrip_' + pi);
        const stopAt = stopAts[pi];
        if (stripEl && stopAt != null) {
          const containerW = stripEl.parentElement ? stripEl.parentElement.offsetWidth : 280;
          const baseX = containerW / 2 - (stopAt * ITEM_WIDTH + ITEM_WIDTH / 2);
          stripEl.style.transition = `transform ${SETTLE_MS}ms ease-out`;
          stripEl.style.transform = 'translateX(' + baseX + 'px)';
          stripEl.querySelectorAll('.cb-open-strip-item-centered').forEach((el) => el.classList.remove('cb-open-strip-item-centered'));
          const centered = stripEl.querySelector('.cb-open-strip-item[data-index="' + stopAt + '"]');
          if (centered) centered.classList.add('cb-open-strip-item-centered');
        }
      }
      await new Promise((r) => setTimeout(r, SETTLE_MS + 200));
      if (!currentBattleId || !lastDetailBattle || lastDetailBattle.id !== currentBattleId) {
        openStripsAnimationRunning = false;
        return;
      }
      const totalRounds = (lastDetailBattle.result && lastDetailBattle.result.roundResults || []).length;
      if (currentReplayRound + 1 < totalRounds) {
        await new Promise((r) => setTimeout(r, PAUSE_AFTER_LAND_MS));
        currentReplayRound++;
        openStripsAnimationRunning = false;
        renderDetailView(lastDetailBattle);
      } else {
        currentReplayRound = totalRounds;
        openStripsAnimationRunning = false;
        renderDetailView(lastDetailBattle);
      }
    };
    setTimeout(onMainAnimationEnd, DURATION_MS + 80);
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

  function buildSlotsGroupedByTeam(byTeam, battle, payoutsBySlot, username, currentRoundIndex) {
    const roundResults = (battle.result && battle.result.roundResults) || [];
    const totalRounds = roundResults.length;
    const replayInProgress = battle.status === 'finished' && totalRounds > 0 && currentRoundIndex < totalRounds;
    const revealedCount = replayInProgress ? currentRoundIndex : totalRounds;
    const hasStrips = battle.status === 'finished' && totalRounds > 0 && roundResults[currentRoundIndex];
    const battleFullyFinished = battle.status === 'finished' && revealedCount === totalRounds;
    const winnerTeamIndex = battle.result && battle.result.winnerTeamIndex != null ? battle.result.winnerTeamIndex : null;
    const isCoop = (battle.mode || '').toLowerCase() === 'coop';
    const isJackpot = (battle.mode || '').toLowerCase() === 'jackpot';
    const jackpotRevealShown = isJackpot && jackpotRevealShownForBattleId === battle.id;
    const currentBattleTotal = isJackpot && revealedCount > 0
      ? roundResults.slice(0, revealedCount).reduce((sum, r) =>
          sum + (r.items || []).reduce((s, it) => s + (Number(it?.value) || 0), 0), 0)
      : 0;
    const teamIndices = Object.keys(byTeam).map(Number).sort((a, b) => a - b);
    let participantIndex = 0;
    const parts = [];
    for (let i = 0; i < teamIndices.length; i++) {
      const team = byTeam[teamIndices[i]];
      const rows = team.map((p) => {
        const pi = participantIndex++;
        const payoutKey = p.teamIndex + '_' + p.slotIndex;
        const payout = payoutsBySlot[payoutKey];
        const payoutAmount = Number(payout) || 0;
        const isTie = battle.result && battle.result.isTie;
        const isWinner = battleFullyFinished && (isCoop || (isTie ? payoutAmount > 0 : (winnerTeamIndex != null ? p.teamIndex === winnerTeamIndex : payoutAmount > 0)));
        const itemsForParticipant = roundResults.slice(0, revealedCount).map((r) => (r.items && r.items[pi]) ? r.items[pi] : null).filter(Boolean);
        const runningTotal = itemsForParticipant.reduce((s, it) => s + (Number(it.value) || 0), 0);
        const displayTotal = replayInProgress ? runningTotal : (p.totalValue != null ? p.totalValue : runningTotal);
        const itemsDisplayOrder = itemsForParticipant;
        const itemsCount = itemsDisplayOrder.length;
        const scrollKey = `${battle.id}_${pi}`;
        const maxScroll = Math.max(0, itemsCount - 5);
        const prevCount = itemsCountByKey[scrollKey] ?? 0;
        itemsCountByKey[scrollKey] = itemsCount;
        let scrollIndex = itemsScrollIndexByKey[scrollKey];
        if (scrollIndex === undefined || itemsCount > prevCount) {
          scrollIndex = maxScroll;
          itemsScrollIndexByKey[scrollKey] = scrollIndex;
        }
        scrollIndex = Math.min(Math.max(0, scrollIndex), maxScroll);
        itemsScrollIndexByKey[scrollKey] = scrollIndex;
        const visibleItems = itemsDisplayOrder.slice(scrollIndex, scrollIndex + 5);
        const showArrows = itemsCount > 5;
        const canScrollLeft = scrollIndex > 0;
        const canScrollRight = scrollIndex < maxScroll;
        const itemsColumnHtml = `<div class="cb-detail-items-column" data-pi="${pi}" data-battle-id="${escapeHtml(battle.id)}">
          ${showArrows ? `<button type="button" class="cb-detail-items-scroll-btn cb-detail-items-scroll-left" data-pi="${pi}" data-battle-id="${escapeHtml(battle.id)}" data-dir="-1" ${!canScrollLeft ? 'disabled' : ''} aria-label="Previous items">‹</button>` : ''}
          <div class="cb-detail-items-row">
            ${visibleItems.map((it) => `
            <div class="cb-detail-item-card">
              ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" class="cb-detail-item-card-img" onerror="this.style.display='none'">` : '<div class="cb-detail-item-card-placeholder">' + escapeHtml(it.name || '') + '</div>'}
              <div class="cb-detail-item-card-price">${formatDollars(it.value || 0)}</div>
            </div>`).join('')}
          </div>
          ${showArrows ? `<button type="button" class="cb-detail-items-scroll-btn cb-detail-items-scroll-right" data-pi="${pi}" data-battle-id="${escapeHtml(battle.id)}" data-dir="1" ${!canScrollRight ? 'disabled' : ''} aria-label="Next items">›</button>` : ''}
        </div>`;
        let slotHtml;
        if (!p.username) {
          const isCreator = battle.createdBy === username;
          slotHtml = `<div class="cb-detail-slot empty">
            <div class="cb-detail-slot-name">Empty</div>
            ${isCreator ? `<button type="button" class="cb-detail-slot-add-bot" data-id="${escapeHtml(battle.id)}" data-slot="${pi}">Add bot</button>` : ''}
          </div>`;
        } else {
          const name = participantDisplayName(p);
          const valueStr = formatDollars(displayTotal);
          const pctLine = isJackpot && currentBattleTotal > 0
            ? `<div class="cb-detail-slot-pct">${(100 * displayTotal / currentBattleTotal).toFixed(1)}% of total</div>`
            : '';
          const teamColorClass = isJackpot ? ` cb-jackpot-team-${p.teamIndex}` : '';
          slotHtml = `<div class="cb-detail-slot${teamColorClass} ${battleFullyFinished && isWinner && (jackpotRevealShown || !isJackpot) ? 'cb-detail-slot-winner' : ''}">
            <div class="cb-detail-slot-name">${escapeHtml(name)}</div>
            ${battle.status === 'finished' ? `<div class="cb-detail-slot-total">Total value: ${escapeHtml(valueStr)}</div>${pctLine}` : ''}
          </div>`;
        }
        let stripHtml;
        if (battleFullyFinished && isJackpot && !jackpotRevealShown) {
          stripHtml = '<div class="cb-detail-strip-cell cb-detail-strip-placeholder"><span class="cb-detail-strip-revealing">Revealing…</span></div>';
        } else if (battleFullyFinished) {
          if (isWinner) {
            stripHtml = `<div class="cb-detail-strip-cell cb-detail-strip-result"><span class="cb-detail-strip-win-yes">${formatDollars(payoutAmount)}</span></div>`;
          } else {
            stripHtml = `<div class="cb-detail-strip-cell cb-detail-strip-result"><span class="cb-detail-strip-win-no">$0</span></div>`;
          }
        } else if (hasStrips) {
          stripHtml = `<div class="cb-detail-strip-cell"><div class="cb-open-strip-container"><div class="cb-open-strip-pointer"></div><div class="cb-open-strip" id="cbOpenStrip_${pi}"></div></div></div>`;
        } else {
          stripHtml = '<div class="cb-detail-strip-cell cb-detail-strip-placeholder"></div>';
        }
        return `<div class="cb-detail-participant-row">${itemsColumnHtml}${slotHtml}${stripHtml}</div>`;
      });
      parts.push(`<div class="cb-detail-team-group">${rows.join('')}</div>`);
      if (i < teamIndices.length - 1) parts.push('<div class="cb-detail-team-divider"></div>');
    }
    return parts.join('');
  }

  function buildCaseCarouselHtml(roundCaseList, idx) {
    if (!roundCaseList || roundCaseList.length === 0) return '<div class="cb-carousel-empty">No cases</div>';
    const curr = roundCaseList[Math.min(idx, roundCaseList.length - 1)];
    if (!curr) return '<div class="cb-carousel-empty">No case</div>';
    const value = curr.price != null ? formatDollars(curr.price) : '';
    return `<div class="cb-carousel-slide cb-carousel-slide-current">
      <div class="cb-carousel-slide-inner">
        ${curr.image ? `<img src="${escapeHtml(curr.image)}" alt="">` : '<div class="cb-carousel-slide-placeholder">' + escapeHtml(curr.name) + '</div>'}
        <div class="cb-carousel-slide-value">${escapeHtml(value)}</div>
      </div>
    </div>`;
  }


  function openBattleCasesPopover(detailCaseItems, totalPot) {
    const items = (detailCaseItems || []).map((it) => ({
      name: it.name,
      count: it.count || 1,
      image: it.image,
      price: it.price,
    }));
    showCasesModal(items, totalPot);
  }

  function showCaseDetailPopup(caseName, casePrice, items) {
    const existing = document.getElementById('cbCaseDetailPopover');
    if (existing) existing.remove();
    const pop = document.createElement('div');
    pop.id = 'cbCaseDetailPopover';
    pop.className = 'cb-cases-popover-overlay';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Case details');
    const itemsList = (items || []).map((it) => {
      const pct = it.probability != null ? Number(it.probability).toFixed(2) + '%' : '—';
      return `<div class="cb-case-detail-item">
        ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" class="cb-case-detail-item-img" onerror="this.style.display='none'">` : '<div class="cb-case-detail-item-pl">' + escapeHtml(it.name || '') + '</div>'}
        <div class="cb-case-detail-item-info">
          <span class="cb-case-detail-item-name">${escapeHtml(it.name || '')}</span>
          <span class="cb-case-detail-item-meta">${formatDollars(it.value || 0)} · ${escapeHtml(pct)}</span>
        </div>
      </div>`;
    }).join('');
    pop.innerHTML = `
      <div class="cb-cases-popover-backdrop"></div>
      <div class="cb-cases-popover-modal cb-case-detail-modal">
        <div class="cb-case-detail-title">${escapeHtml(caseName)}</div>
        <div class="cb-case-detail-price">${casePrice != null ? formatDollars(casePrice) : '—'}</div>
        <div class="cb-case-detail-items">${itemsList || '<p class="cb-case-detail-empty">No items</p>'}</div>
        <button type="button" class="cb-cases-popover-close">Close</button>
      </div>`;
    document.body.appendChild(pop);
    pop.classList.add('cb-cases-popover-enter');
    const close = () => { pop.classList.remove('cb-cases-popover-enter'); pop.classList.add('cb-cases-popover-leave'); setTimeout(() => pop.remove(), 200); };
    pop.querySelector('.cb-cases-popover-close').addEventListener('click', close);
    pop.querySelector('.cb-cases-popover-backdrop').addEventListener('click', close);
  }

  function showCasesModal(items, totalPot) {
    const existing = document.getElementById('cbCasesPopover');
    if (existing) existing.remove();
    const pop = document.createElement('div');
    pop.id = 'cbCasesPopover';
    pop.className = 'cb-cases-popover-overlay';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    pop.setAttribute('aria-label', 'Cases in this battle');
    const hasPrices = totalPot != null && items.some((it) => it.price != null);
    pop.innerHTML = `
      <div class="cb-cases-popover-backdrop"></div>
      <div class="cb-cases-popover-modal cb-cases-popover-battle">
        <div class="cb-cases-popover-title">Cases in this battle</div>
        <div class="cb-cases-popover-list">${items.map((it) => `
          <div class="cb-cases-popover-item">
            ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" class="cb-cases-popover-img" onerror="this.style.display='none'">` : ''}
            <div class="cb-cases-popover-item-info">
              <span class="cb-cases-popover-name">${escapeHtml(it.name)}${it.count > 1 ? ' ×' + it.count : ''}</span>
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

  let addCasesTempCounts = {};

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
          const count = addCasesTempCounts[c.id] ?? 0;
          return `<div class="cb-add-cases-item" data-case-id="${escapeHtml(c.id)}">
            <div class="cb-add-cases-item-info">
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
    addCasesList.querySelectorAll('.cb-add-cases-item-plus').forEach((el) => {
      el.addEventListener('click', () => {
        const caseId = el.getAttribute('data-case-id');
        addCasesTempCounts[caseId] = (addCasesTempCounts[caseId] ?? 0) + 1;
        const display = addCasesList.querySelector(`.cb-add-cases-item-count-display[data-case-id="${caseId}"]`);
        if (display) display.textContent = addCasesTempCounts[caseId];
      });
    });
    addCasesList.querySelectorAll('.cb-add-cases-item-minus').forEach((el) => {
      el.addEventListener('click', () => {
        const caseId = el.getAttribute('data-case-id');
        const cur = addCasesTempCounts[caseId] ?? 0;
        if (cur > 0) {
          addCasesTempCounts[caseId] = cur - 1;
          const display = addCasesList.querySelector(`.cb-add-cases-item-count-display[data-case-id="${caseId}"]`);
          if (display) display.textContent = addCasesTempCounts[caseId];
        }
      });
    });
  }

  function applyAddCasesAndClose() {
    battleCasesForCreate = [];
    for (const [caseId, count] of Object.entries(addCasesTempCounts)) {
      if (count > 0) battleCasesForCreate.push({ caseId, count });
    }
    renderBattleCasesForCreate();
    updateEntryTotal();
    closeAddCasesModal();
  }

  function openAddCasesModal() {
    addCasesTempCounts = {};
    for (const { caseId, count } of battleCasesForCreate) {
      addCasesTempCounts[caseId] = (addCasesTempCounts[caseId] ?? 0) + count;
    }
    loadCases().then(() => {
      if (addCasesModal) {
        addCasesModal.classList.remove('hidden');
        renderAddCasesModalList();
        casesSearchInput?.focus();
      }
    });
  }

  function closeAddCasesModal() {
    if (addCasesModal) addCasesModal.classList.add('hidden');
  }

  async function loadBattles() {
    try {
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
    if (!name) {
      alert('Enter case name');
      return;
    }
    const items = caseFormItems.map((row, i) => {
      const nameEl = itemsListEl?.querySelector(`.cb-item-name[data-i="${i}"]`);
      const img = itemsListEl?.querySelector(`.cb-item-image[data-i="${i}"]`);
      const val = itemsListEl?.querySelector(`.cb-item-value[data-i="${i}"]`);
      const pct = itemsListEl?.querySelector(`.cb-item-pct[data-i="${i}"]`);
      return {
        name: (nameEl?.value || '').trim(),
        image: (img?.value || '').trim(),
        value: Number(val?.value) || 0,
        probability: Number(pct?.value) != null ? Number(pct?.value) : 0,
      };
    });
    const rtp = Number(rtpInput?.value) || 95;
    try {
      const res = await fetch(API + '/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name, rtpDecimal: rtp / 100, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save case');
        return;
      }
      await loadCases();
      caseFormItems = [{ name: '', image: '', value: '', probability: '' }];
      renderCaseFormItems();
      caseNameInput.value = '';
      caseCostEl.textContent = '';
      if (caseCostEl) caseCostEl.classList.remove('cb-case-cost-ok');
      closeAddCaseModal();
    } catch (e) {
      alert('Network error');
    }
  }

  function openAddCaseModal() {
    if (addCaseModal) {
      caseFormItems = caseFormItems.length ? caseFormItems : [{ name: '', image: '', value: '', probability: '' }];
      renderCaseFormItems();
      caseCostEl.textContent = '';
      if (caseCostEl) caseCostEl.classList.remove('cb-case-cost-ok');
      addCaseModal.classList.remove('hidden');
      caseNameInput?.focus();
    }
  }

  function closeAddCaseModal() {
    if (addCaseModal) addCaseModal.classList.add('hidden');
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

  async function joinBattle(id) {
    try {
      const res = await fetch(API + '/battles/' + encodeURIComponent(id) + '/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
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
    if (addCustomCaseBtn) addCustomCaseBtn.classList.toggle('hidden', !isAdminOrOwner());
    if (createBattleModal) createBattleModal.classList.add('hidden');
    loadCases();
    loadBattles();
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
    showListView();
  }

  function onHide() {
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
  window.addEventListener('popstate', () => {
    const hash = (window.location.hash || '').slice(1);
    if (hash.startsWith('case-battle/')) {
      const battleId = decodeURIComponent(hash.slice('case-battle/'.length));
      if (battleId) showBattleDetail(battleId);
    } else if (hash === 'case-battle') {
      showListView();
      loadBattles();
    }
  });

  if (addItemBtn) addItemBtn.addEventListener('click', () => {
    syncCaseFormFromDom();
    caseFormItems.push({ name: '', image: '', value: '', probability: '' });
    renderCaseFormItems();
    recalcCaseCost();
  });
  if (saveCaseBtn) saveCaseBtn.addEventListener('click', saveCase);
  if (createBattleBtn) createBattleBtn.addEventListener('click', createBattle);
  if (addCustomCaseBtn) addCustomCaseBtn.addEventListener('click', openAddCaseModal);
  if (addCaseClose) addCaseClose.addEventListener('click', closeAddCaseModal);
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
  if (backToList) backToList.addEventListener('click', () => {
    showListView();
    loadBattles();
    if (window.location.hash.startsWith('#case-battle/')) {
      window.history.replaceState(null, '', '#case-battle');
    }
  });
  setupBattleListDelegation();

  window.CaseBattle = { onShow, onHide };
})();

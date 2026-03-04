/**
 * Case Battle: tab page; case management (owner/admin only), create battle (all users), active battles list, join/spectate, add bots.
 */
(function () {
  const API = '/api/case-battle';

  function getAuthHeaders() {
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

  const adminWrap = document.getElementById('caseBattleAdminWrap');
  const caseNameInput = document.getElementById('cbCaseName');
  const rtpInput = document.getElementById('cbRtp');
  const itemsListEl = document.getElementById('cbItemsList');
  const caseCostEl = document.getElementById('cbCaseCost');
  const saveCaseBtn = document.getElementById('cbSaveCase');
  const addItemBtn = document.getElementById('cbAddItem');
  const formatSelect = document.getElementById('cbFormat');
  const modeSelect = document.getElementById('cbMode');
  const battleCasesEl = document.getElementById('cbBattleCases');
  const addCaseToBattleBtn = document.getElementById('cbAddCaseToBattle');
  const selectCaseEl = document.getElementById('cbSelectCase');
  const caseCountInput = document.getElementById('cbCaseCount');
  const botCountInput = document.getElementById('cbBotCount');
  const entryTotalEl = document.getElementById('cbEntryTotal');
  const createBattleBtn = document.getElementById('cbCreateBattle');
  const battleListEl = document.getElementById('caseBattleList');

  let caseFormItems = [{ image: '', value: '', probability: '' }];

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function renderCaseFormItems() {
    if (!itemsListEl) return;
    itemsListEl.innerHTML = caseFormItems
      .map(
        (item, i) =>
          `<div class="cb-item-row">
            <input type="text" class="cb-item-image" data-i="${i}" placeholder="Image URL" value="${escapeHtml(item.image)}">
            <input type="number" class="cb-item-value" data-i="${i}" placeholder="Value $" min="0" step="0.01" value="${item.value !== '' ? item.value : ''}">
            <input type="number" class="cb-item-pct" data-i="${i}" placeholder="%" min="0" max="100" step="0.01" value="${item.probability !== '' ? item.probability : ''}">
            <button type="button" class="btn-cb-remove-item" data-i="${i}" aria-label="Remove">×</button>
          </div>`
      )
      .join('');
    itemsListEl.querySelectorAll('.cb-item-image, .cb-item-value, .cb-item-pct').forEach((el) => {
      el.addEventListener('input', recalcCaseCost);
      el.addEventListener('change', recalcCaseCost);
    });
    itemsListEl.querySelectorAll('.btn-cb-remove-item').forEach((el) => {
      el.addEventListener('click', () => {
        const i = parseInt(el.getAttribute('data-i'), 10);
        caseFormItems.splice(i, 1);
        if (caseFormItems.length === 0) caseFormItems = [{ image: '', value: '', probability: '' }];
        renderCaseFormItems();
        recalcCaseCost();
      });
    });
  }

  async function recalcCaseCost() {
    if (!caseCostEl) return;
    const items = caseFormItems.map((row, i) => {
      const img = itemsListEl?.querySelector(`.cb-item-image[data-i="${i}"]`);
      const val = itemsListEl?.querySelector(`.cb-item-value[data-i="${i}"]`);
      const pct = itemsListEl?.querySelector(`.cb-item-pct[data-i="${i}"]`);
      return {
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
        caseCostEl.textContent = 'Case cost: $' + Number(data.price).toFixed(2) + ' (EV: $' + Number(data.ev).toFixed(2) + ')';
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
    entryTotalEl.textContent = total > 0 ? 'Entry: $' + total.toFixed(2) : '';
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

  function renderBattleList(battles) {
    if (!battleListEl) return;
    const user = typeof window.Auth !== 'undefined' && window.Auth.getCurrentUser ? window.Auth.getCurrentUser() : null;
    const username = user?.username || '';
    battleListEl.innerHTML = battles.length === 0
      ? '<p class="case-battle-empty">No active battles. Create one above or wait for one to appear.</p>'
      : battles
          .map((b) => {
            const filled = b.participants.filter((p) => p.username).length;
            const hasEmpty = filled < b.totalSlots;
            const mySlot = b.participants.find((p) => p.username === username);
            const entryEach = b.totalPot / Math.max(1, b.participants.filter((p) => p.username && !p.isBot).length);
            return `<div class="case-battle-card" data-id="${escapeHtml(b.id)}">
              <div class="cb-card-header">
                <span class="cb-card-format">${escapeHtml(b.format)}</span>
                <span class="cb-card-mode">${escapeHtml(b.mode)}</span>
                <span class="cb-card-pot">$${Number(b.totalPot).toFixed(2)}</span>
              </div>
              <div class="cb-card-slots">${filled}/${b.totalSlots} slots</div>
              <div class="cb-card-actions">
                ${mySlot ? '<span class="cb-you-in">You are in</span>' : hasEmpty && username ? `<button type="button" class="btn btn-cb-join" data-id="${escapeHtml(b.id)}">Join ($${entryEach.toFixed(2)})</button>` : ''}
                ${hasEmpty && mySlot ? `<button type="button" class="btn btn-cb-add-bot" data-id="${escapeHtml(b.id)}">Add bot</button>` : ''}
                <button type="button" class="btn btn-cb-spectate" data-id="${escapeHtml(b.id)}">${filled >= b.totalSlots ? 'Watch' : 'Spectate'}</button>
              </div>
            </div>`;
          })
          .join('');
    battleListEl.querySelectorAll('.btn-cb-join').forEach((el) => {
      el.addEventListener('click', () => joinBattle(el.getAttribute('data-id')));
    });
    battleListEl.querySelectorAll('.btn-cb-add-bot').forEach((el) => {
      el.addEventListener('click', () => addBot(el.getAttribute('data-id')));
    });
    battleListEl.querySelectorAll('.btn-cb-spectate').forEach((el) => {
      el.addEventListener('click', () => spectateBattle(el.getAttribute('data-id')));
    });
  }

  async function loadCases() {
    try {
      const res = await fetch(API + '/cases', { headers: getAuthHeaders() });
      const data = await res.json();
      casesList = data.cases || [];
      if (selectCaseEl) {
        selectCaseEl.innerHTML = '<option value="">-- Select case --</option>' + (casesList.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} ($${Number(c.price).toFixed(2)})</option>`).join(''));
      }
    } catch (e) {
      casesList = [];
    }
  }

  async function loadBattles() {
    try {
      const res = await fetch(API + '/battles', { headers: getAuthHeaders() });
      const data = await res.json();
      renderBattleList(data.battles || []);
    } catch (e) {
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
      const val = itemsListEl?.querySelector(`.cb-item-value[data-i="${i}"]`);
      const pct = itemsListEl?.querySelector(`.cb-item-pct[data-i="${i}"]`);
      const img = itemsListEl?.querySelector(`.cb-item-image[data-i="${i}"]`);
      return {
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
      caseFormItems = [{ image: '', value: '', probability: '' }];
      renderCaseFormItems();
      caseNameInput.value = '';
      caseCostEl.textContent = '';
      if (caseCostEl) caseCostEl.classList.remove('cb-case-cost-ok');
    } catch (e) {
      alert('Network error');
    }
  }

  async function createBattle() {
    if (battleCasesForCreate.length === 0) {
      alert('Add at least one case to the battle');
      return;
    }
    const caseIds = battleCasesForCreate.map(({ caseId, count }) => ({ caseId, count }));
    const botCount = Math.max(0, parseInt(botCountInput?.value, 10) || 0);
    try {
      const res = await fetch(API + '/battles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          format: formatSelect?.value || '1v1',
          mode: modeSelect?.value || 'standard',
          caseIds,
          botCount,
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
      await loadBattles();
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
      await loadBattles();
    } catch (e) {
      alert('Network error');
    }
  }

  async function addBot(id) {
    try {
      const res = await fetch(API + '/battles/' + encodeURIComponent(id) + '/add-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Cannot add bot');
        return;
      }
      await loadBattles();
    } catch (e) {
      alert('Network error');
    }
  }

  function spectateBattle(id) {
    // Placeholder: could open a battle view modal or navigate to battle room
    console.log('Spectate battle', id);
  }

  function addCaseToBattle() {
    const caseId = selectCaseEl?.value;
    const count = Math.max(1, parseInt(caseCountInput?.value, 10) || 1);
    if (!caseId) {
      alert('Select a case');
      return;
    }
    battleCasesForCreate.push({ caseId, count });
    renderBattleCasesForCreate();
  }

  function onShow() {
    if (adminWrap) adminWrap.classList.toggle('hidden', !isAdminOrOwner());
    loadCases();
    loadBattles();
    renderCaseFormItems();
    renderBattleCasesForCreate();
    pollTimer = setInterval(loadBattles, 5000);
  }

  function onHide() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  if (addItemBtn) addItemBtn.addEventListener('click', () => {
    caseFormItems.push({ image: '', value: '', probability: '' });
    renderCaseFormItems();
  });
  if (saveCaseBtn) saveCaseBtn.addEventListener('click', saveCase);
  if (createBattleBtn) createBattleBtn.addEventListener('click', createBattle);
  if (addCaseToBattleBtn) addCaseToBattleBtn.addEventListener('click', addCaseToBattle);

  window.CaseBattle = { onShow, onHide };
})();

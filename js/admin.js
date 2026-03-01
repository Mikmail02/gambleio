/**
 * Admin panel: user list, detail view, adjust XP/Money (owner or isAdmin only).
 */
(function () {
  const API = '/api';
  let selectedUsername = null;
  let allUsers = [];
  const ROLE_LABELS = { member: 'Member', mod: 'Mod', admin: 'Admin', owner: 'Owner' };

  function getToken() {
    return localStorage.getItem('gambleio_token');
  }

  function getAuthHeaders() {
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function canShowAdmin() {
    const user = window.Auth && window.Auth.user;
    const role = (user && user.role) ? user.role.toLowerCase() : '';
    return role === 'owner' || role === 'admin' || role === 'mod';
  }

  function getMyRole() {
    const user = window.Auth && window.Auth.user;
    const r = (user && user.role != null) ? String(user.role).toLowerCase() : '';
    return ['owner', 'admin', 'mod', 'member'].includes(r) ? r : '';
  }

  function getAssignableRoles() {
    const myRole = getMyRole();
    if (myRole === 'owner') return ROLES;
    if (myRole === 'admin') return ROLES.filter((r) => r.key !== 'owner');
    if (myRole === 'mod') return ROLES.filter((r) => r.key !== 'owner' && r.key !== 'admin');
    return [];
  }

  /** Can the current user modify a user with targetRole? Mod: only null/member. Admin: null/member/mod. Owner: all. */
  function canModifyUser(targetRole) {
    const myRole = getMyRole();
    if (myRole === 'owner') return true;
    const t = (targetRole == null || targetRole === '') ? null : String(targetRole).toLowerCase();
    if (myRole === 'admin') return t !== 'admin' && t !== 'owner';
    if (myRole === 'mod') return t === null || t === 'member';
    return false;
  }

  function showNoAccessModal() {
    const modal = document.getElementById('noAccessModal');
    const backdrop = document.getElementById('noAccessBackdrop');
    const ok = document.getElementById('noAccessOk');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    const close = () => {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      if (ok) ok.removeEventListener('click', close);
      if (backdrop) backdrop.removeEventListener('click', close);
    };
    if (ok) ok.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
  }

  function updateAdminButtonVisibility() {
    const btn = document.getElementById('adminBtn');
    if (!btn) return;
    if (!canShowAdmin()) {
      btn.classList.add('hidden');
      return;
    }
    btn.classList.remove('hidden');
    const myRole = getMyRole();
    const label = ROLES.find((r) => r.key === myRole);
    btn.textContent = label ? label.label : 'Admin';
    btn.className = 'btn-admin-header btn-admin-header--role btn-admin-header--' + myRole;
    const logsBtn = document.getElementById('logsBtn');
    const isOwner = (window.Auth && window.Auth.user && (window.Auth.user.isOwner || window.Auth.user.role === 'owner'));
    if (logsBtn) logsBtn.classList.toggle('hidden', !isOwner);
  }

  const ROLES = [
    { key: 'member', label: 'Member' },
    { key: 'mod', label: 'Mod' },
    { key: 'admin', label: 'Admin' },
    { key: 'owner', label: 'Owner' },
  ];

  function getModalEls() {
    return {
      modal: document.getElementById('adminModal'),
      backdrop: document.getElementById('adminModalBackdrop'),
      close: document.getElementById('adminModalClose'),
      listPanel: document.getElementById('adminPanelList'),
      list: document.getElementById('adminUserList'),
      listSearch: document.getElementById('adminUserSearch'),
      listLoading: document.getElementById('adminListLoading'),
      detail: document.getElementById('adminUserDetail'),
      detailBack: document.getElementById('adminDetailBack'),
      detailName: document.getElementById('adminDetailName'),
      detailCurrentRole: document.getElementById('adminDetailCurrentRole'),
      detailRoles: document.getElementById('adminDetailRoles'),
      detailStats: document.getElementById('adminDetailStats'),
      xpInput: document.getElementById('adminXpInput'),
      moneyInput: document.getElementById('adminMoneyInput'),
      xpBtn: document.getElementById('adminXpBtn'),
      moneyBtn: document.getElementById('adminMoneyBtn'),
      muteMinutes: document.getElementById('adminMuteMinutes'),
      muteBtn: document.getElementById('adminMuteBtn'),
      unmuteBtn: document.getElementById('adminUnmuteBtn'),
      mutedUntil: document.getElementById('adminMutedUntil'),
      chatLogsBtn: document.getElementById('adminChatLogsBtn'),
      chatLogsModal: document.getElementById('chatLogsModal'),
      chatLogsModalClose: document.getElementById('chatLogsModalClose'),
      chatLogsModalBackdrop: document.getElementById('chatLogsModalBackdrop'),
      chatLogsList: document.getElementById('chatLogsList'),
      chatLogsLoading: document.getElementById('chatLogsLoading'),
      chatLogsModalTitle: document.getElementById('chatLogsModalTitle'),
    };
  }

  function openModal() {
    if (!canShowAdmin()) return;
    const { modal, listPanel, detail } = getModalEls();
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (listPanel) listPanel.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
    selectedUsername = null;
    loadUserList();
  }

  function closeModal() {
    const { modal } = getModalEls();
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    selectedUsername = null;
  }

  function roleLabel(role) {
    if (role == null || role === '') return null;
    return ROLE_LABELS[String(role).toLowerCase()] || null;
  }

  function renderUserList(users) {
    const { list, listLoading } = getModalEls();
    if (!list) return;
    const existingUl = list.querySelector('.admin-user-list');
    if (existingUl) existingUl.remove();
    const existingEmpty = list.querySelector('.admin-empty, .admin-error');
    if (existingEmpty) existingEmpty.remove();
    if (users.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'admin-empty';
      empty.textContent = allUsers.length ? 'No users match your search' : 'No users';
      list.appendChild(empty);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'admin-user-list';
    users.forEach((u) => {
      const li = document.createElement('li');
      li.className = 'admin-user-item';
      const r = u.role == null || u.role === '' ? null : String(u.role).toLowerCase();
      const roleBadge = r && ROLE_LABELS[r] ? '<span class="admin-list-role-tag admin-role-tag--' + r + '">' + escapeHtml(ROLE_LABELS[r]) + '</span>' : '';
      const id = (u.profileSlug || '').trim();
      li.innerHTML = `
        <span class="admin-user-name-cell">
          <span class="admin-user-name">${escapeHtml(u.displayName || u.username)}</span>
          ${id ? '<span class="admin-user-id" title="User ID">' + escapeHtml(id) + '</span>' : ''}
          ${roleBadge}
        </span>
        <span class="admin-user-meta">Lv ${u.level} · ${formatDollars(u.balance)}</span>
      `;
      li.dataset.username = u.username;
      li.dataset.role = r || '';
      ul.appendChild(li);
    });
    list.appendChild(ul);
  }

  async function loadUserList() {
    const { list, listSearch, listLoading } = getModalEls();
    if (!list) return;
    const existingUl = list.querySelector('.admin-user-list');
    if (existingUl) existingUl.remove();
    const existingEmpty = list.querySelector('.admin-empty, .admin-error');
    if (existingEmpty) existingEmpty.remove();
    if (listLoading) {
      listLoading.classList.remove('hidden');
      if (!list.contains(listLoading)) list.appendChild(listLoading);
    }
    if (listSearch) listSearch.value = '';

    try {
      const res = await fetch(API + '/admin/users', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(res.status === 403 ? 'Forbidden' : 'Failed to load');
      let users = await res.json();
      const myRole = getMyRole();
      const me = window.Auth && window.Auth.user && window.Auth.user.username;
      if (myRole !== 'owner' && me) users = users.filter((u) => (u.username || '').toLowerCase() !== (me || '').toLowerCase());
      allUsers = users;
      if (listLoading) listLoading.classList.add('hidden');
      renderUserList(allUsers);
    } catch (e) {
      if (listLoading) listLoading.classList.add('hidden');
      const err = document.createElement('div');
      err.className = 'admin-error';
      err.textContent = e.message || 'Failed to load users';
      list.appendChild(err);
    }
  }

  function showDetail(user) {
    const { list, detail, detailName, detailCurrentRole, detailRoles, detailStats, xpInput, moneyInput } = getModalEls();
    if (!detail || !user) return;
    selectedUsername = user.username;
    const listPanel = getModalEls().listPanel;
    if (listPanel) listPanel.classList.add('hidden');
    detail.classList.remove('hidden');
    detailName.textContent = user.displayName || user.username;
    xpInput.value = '';
    moneyInput.value = '';

    const actualRole = user.role == null || user.role === '' ? null : String(user.role).toLowerCase();
    const currentRoleForDisplay = actualRole || 'member';
    if (detailCurrentRole) {
      const label = roleLabel(actualRole);
      if (label) {
        detailCurrentRole.textContent = label;
        detailCurrentRole.className = 'admin-detail-current-role admin-role-tag admin-role-tag--' + currentRoleForDisplay;
        detailCurrentRole.classList.remove('hidden');
      } else {
        detailCurrentRole.classList.add('hidden');
      }
    }

    const assignable = getAssignableRoles();
    const canGive = assignable.filter((r) => (r.key === 'member' && actualRole !== 'member') || (r.key !== 'member' && actualRole !== r.key));
    if (detailRoles) {
      detailRoles.innerHTML = '';
      canGive.forEach((r) => {
        const tag = document.createElement('button');
        tag.type = 'button';
        tag.className = 'admin-role-tag admin-role-tag--' + r.key;
        tag.textContent = r.label;
        tag.dataset.role = r.key;
        tag.addEventListener('click', () => setRole(user.username, r.key, r.label));
        detailRoles.appendChild(tag);
      });
    }

    detailStats.innerHTML = `
      <div class="admin-stat"><span class="admin-stat-label">Balance</span><span class="admin-stat-value">${formatDollars(user.balance ?? 0)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Level</span><span class="admin-stat-value">${user.level}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">XP</span><span class="admin-stat-value">${formatNumber(user.xp || 0)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Total Clicks</span><span class="admin-stat-value">${formatNumber(user.totalClicks || 0)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Total Bets</span><span class="admin-stat-value">${formatNumber(user.totalBets || 0)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Total Won</span><span class="admin-stat-value">${formatDollars(user.totalGamblingWins || 0)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Wins (profit)</span><span class="admin-stat-value">${formatNumber(user.totalWinsCount || 0)}</span></div>
      <div class="admin-stat"><span class="admin-stat-label">Biggest Win</span><span class="admin-stat-value">${formatDollars(user.biggestWinAmount || 0)} ${user.biggestWinMultiplier ? user.biggestWinMultiplier + '×' : ''}</span></div>
    `;
    const detailActions = detail.querySelector('.admin-detail-actions');
    if (detailActions) detailActions.style.display = '';
    const adjustRows = detail.querySelectorAll('.admin-adjust-row');
    adjustRows.forEach((el) => { el.style.display = getMyRole() === 'mod' ? 'none' : ''; });
    const { muteMinutes, muteBtn, unmuteBtn, mutedUntil } = getModalEls();
    if (muteMinutes) muteMinutes.value = '';
    if (mutedUntil) {
      const until = user.chatMutedUntil != null ? Number(user.chatMutedUntil) : 0;
      if (until > Date.now()) {
        mutedUntil.textContent = 'Muted until ' + new Date(until).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
        mutedUntil.classList.remove('hidden');
      } else {
        mutedUntil.textContent = '';
        mutedUntil.classList.add('hidden');
      }
    }
    if (muteBtn) muteBtn.onclick = () => applyMute(user.username, true);
    if (unmuteBtn) unmuteBtn.onclick = () => applyMute(user.username, false);
    const { chatLogsBtn, chatLogsModalTitle } = getModalEls();
    if (chatLogsBtn) {
      chatLogsBtn.onclick = () => openChatLogsModal(user.username, user.displayName || user.username);
    }
    if (chatLogsModalTitle) {
      chatLogsModalTitle.textContent = 'Chat logs';
    }
  }

  async function openChatLogsModal(username, displayName) {
    const { chatLogsModal, chatLogsList, chatLogsLoading, chatLogsModalTitle, chatLogsModalClose, chatLogsModalBackdrop } = getModalEls();
    if (!chatLogsModal || !username) return;
    chatLogsModal.classList.remove('hidden');
    chatLogsModal.setAttribute('aria-hidden', 'false');
    if (chatLogsModalTitle) chatLogsModalTitle.textContent = 'Chat logs: ' + (displayName || username);
    if (chatLogsList) chatLogsList.innerHTML = '';
    if (chatLogsLoading) chatLogsLoading.classList.remove('hidden');
    try {
      const res = await fetch(API + '/admin/users/' + encodeURIComponent(username) + '/chat-logs', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json().catch(() => ({}));
      if (chatLogsLoading) chatLogsLoading.classList.add('hidden');
      const messages = data.messages || [];
      if (!chatLogsList) return;
      if (messages.length === 0) {
        chatLogsList.innerHTML = '<li class="logs-empty">No chat messages from this user.</li>';
      } else {
        messages.forEach((m) => {
          const li = document.createElement('li');
          li.className = 'logs-entry';
          const ts = m.time != null ? Number(m.time) : NaN;
          const time = Number.isFinite(ts) ? new Date(ts).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '—';
          li.textContent = time + ' — ' + (m.text || '');
          chatLogsList.appendChild(li);
        });
      }
    } catch (e) {
      if (chatLogsLoading) chatLogsLoading.classList.add('hidden');
      if (chatLogsList) chatLogsList.innerHTML = '<li class="admin-error">' + (e.message || 'Failed to load chat logs') + '</li>';
    }
    const close = () => {
      chatLogsModal.classList.add('hidden');
      chatLogsModal.setAttribute('aria-hidden', 'true');
      if (chatLogsModalClose) chatLogsModalClose.removeEventListener('click', close);
      if (chatLogsModalBackdrop) chatLogsModalBackdrop.removeEventListener('click', close);
    };
    if (chatLogsModalClose) chatLogsModalClose.addEventListener('click', close);
    if (chatLogsModalBackdrop) chatLogsModalBackdrop.addEventListener('click', close);
  }

  async function applyMute(username, isMute) {
    const { muteMinutes } = getModalEls();
    try {
      const body = isMute
        ? { minutes: Math.max(1, parseInt(muteMinutes && muteMinutes.value, 10) || 60) }
        : { unmute: true };
      const res = await fetch(API + '/admin/users/' + encodeURIComponent(username) + '/mute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed');
      }
      if (muteMinutes) muteMinutes.value = '';
      await loadUserDetail(username);
    } catch (e) {
      alert(e.message || 'Mute failed');
    }
  }

  function showList() {
    const { listPanel, detail } = getModalEls();
    if (listPanel) listPanel.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
    selectedUsername = null;
  }

  async function loadUserDetail(username) {
    try {
      const res = await fetch(API + '/admin/users/' + encodeURIComponent(username), { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load user');
      const user = await res.json();
      showDetail(user);
    } catch (e) {
      alert(e.message || 'Failed to load user');
    }
  }

  function parseAdjustValue(str) {
    const s = String(str || '').trim();
    if (!s) return null;
    const num = parseInt(s, 10);
    if (!Number.isFinite(num)) return null;
    return num;
  }

  function getConfirmEls() {
    return {
      modal: document.getElementById('roleConfirmModal'),
      backdrop: document.getElementById('roleConfirmBackdrop'),
      message: document.getElementById('roleConfirmMessage'),
      cancel: document.getElementById('roleConfirmCancel'),
      ok: document.getElementById('roleConfirmOk'),
    };
  }

  function formatLogEntry(entry) {
    const ts = entry.timestamp != null ? Number(entry.timestamp) : NaN;
    const time = Number.isFinite(ts) ? new Date(ts).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
    const actor = entry.actorDisplayName || entry.actorUsername || 'System';
    const target = entry.targetDisplayName || entry.targetUsername || '—';
    switch (entry.type) {
      case 'user_registered':
        return time + ' — New user registered: ' + target + ' (' + (entry.targetUsername || '') + ')';
      case 'level_up':
        return time + ' — ' + target + ' leveled up to Level ' + (entry.newLevel || '?') + (entry.previousLevel != null ? ' (from ' + entry.previousLevel + ')' : '');
      case 'role_assigned':
        return time + ' — ' + actor + ' gave ' + target + ' the ' + (entry.role || '') + ' role';
      case 'adjust':
        const type = entry.adjustType === 'xp' ? 'XP' : 'Money';
        const val = entry.value != null ? (entry.value >= 0 ? '+' + entry.value : entry.value) : '?';
        return time + ' — ' + actor + ' adjusted ' + target + "'s " + type + ': ' + val;
      case 'chat_mute':
        const meta = entry.meta || {};
        return time + ' — ' + actor + ' ' + (meta.until ? 'muted ' + target + ' until ' + new Date(meta.until).toLocaleString('en-US') : 'unmuted ' + target);
      default:
        return time + ' — ' + (entry.type || 'event');
    }
  }

  function openLogsModal() {
    const modal = document.getElementById('logsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    loadLogs();
  }

  function closeLogsModal() {
    const modal = document.getElementById('logsModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  async function loadLogs() {
    const list = document.getElementById('logsList');
    const loading = document.getElementById('logsLoading');
    if (loading) loading.classList.remove('hidden');
    if (list) list.innerHTML = '';
    try {
      const res = await fetch(API + '/admin/logs?limit=500', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to load logs');
      const logs = await res.json();
      if (loading) loading.classList.add('hidden');
      if (!list) return;
      if (!Array.isArray(logs) || logs.length === 0) {
        list.innerHTML = '<li class="logs-empty">No logs yet.</li>';
        return;
      }
      logs.forEach((entry) => {
        const li = document.createElement('li');
        li.className = 'logs-entry';
        li.textContent = formatLogEntry(entry);
        list.appendChild(li);
      });
    } catch (e) {
      if (loading) loading.classList.add('hidden');
      if (list) list.innerHTML = '<li class="admin-error">' + escapeHtml(e.message || 'Failed to load logs') + '</li>';
    }
  }

  async function setRole(username, role, roleLabel) {
    const { detailName } = getModalEls();
    const displayName = (detailName && detailName.textContent) || username;
    const confirmed = await new Promise((resolve) => {
      const { modal, message, cancel, ok, backdrop } = getConfirmEls();
      if (!modal || !message) {
        resolve(false);
        return;
      }
      message.textContent = 'Do you want to give ' + displayName + ' the ' + roleLabel + ' role?';
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      const onChoice = (yes) => {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        if (cancel) cancel.removeEventListener('click', onCancel);
        if (ok) ok.removeEventListener('click', onOk);
        if (backdrop) backdrop.removeEventListener('click', onCancel);
        resolve(yes);
      };
      const onCancel = () => onChoice(false);
      const onOk = () => onChoice(true);
      if (cancel) cancel.addEventListener('click', onCancel);
      if (ok) ok.addEventListener('click', onOk);
      if (backdrop) backdrop.addEventListener('click', onCancel);
    });
    if (!confirmed) return;
    try {
      const res = await fetch(API + '/admin/users/' + encodeURIComponent(username) + '/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to set role');
      showDetail(data);
      const idx = allUsers.findIndex((u) => (u.username || '').toLowerCase() === (data.username || '').toLowerCase());
      if (idx >= 0) {
        allUsers[idx] = { ...allUsers[idx], role: data.role, isAdmin: data.isAdmin, isOwner: data.isOwner };
      }
    } catch (e) {
      alert(e.message || 'Failed to set role');
    }
  }

  async function applyAdjust(type, value) {
    if (!selectedUsername) return;
    const num = parseAdjustValue(value);
    if (num === null) {
      alert('Enter a number (e.g. 500 or -100)');
      return;
    }
    try {
      const res = await fetch(API + '/admin/users/' + encodeURIComponent(selectedUsername) + '/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ type, value: num }),
      });
      if (!res.ok) throw new Error('Request failed');
      await res.json();
      if (type === 'xp') getModalEls().xpInput.value = '';
      else getModalEls().moneyInput.value = '';
      loadUserDetail(selectedUsername);
    } catch (e) {
      alert(e.message || 'Failed to apply');
    }
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n ?? 0);
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('en').format(n ?? 0);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function bind() {
    const adminBtn = document.getElementById('adminBtn');
    const logsBtn = document.getElementById('logsBtn');
    const { backdrop, close, list, detailBack, xpBtn, moneyBtn, xpInput, moneyInput } = getModalEls();

    if (adminBtn) adminBtn.addEventListener('click', openModal);
    if (logsBtn) logsBtn.addEventListener('click', openLogsModal);
    if (document.getElementById('logsModalBackdrop')) document.getElementById('logsModalBackdrop').addEventListener('click', closeLogsModal);
    if (document.getElementById('logsModalClose')) document.getElementById('logsModalClose').addEventListener('click', closeLogsModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (close) close.addEventListener('click', closeModal);
    if (detailBack) detailBack.addEventListener('click', showList);

    if (list) {
      list.addEventListener('click', (e) => {
        const item = e.target.closest('.admin-user-item');
        if (!item || !item.dataset.username) return;
        const targetRole = item.dataset.role || null;
        if (!canModifyUser(targetRole)) {
          showNoAccessModal();
          return;
        }
        loadUserDetail(item.dataset.username);
      });
    }
    const listSearch = getModalEls().listSearch;
    if (listSearch) {
      listSearch.addEventListener('input', () => {
        const q = (listSearch.value || '').trim().toLowerCase();
        if (!q) {
          renderUserList(allUsers);
          return;
        }
        const filtered = allUsers.filter((u) => {
          const name = (u.displayName || u.username || '').toLowerCase();
          const username = (u.username || '').toLowerCase();
          const id = (u.profileSlug || '').toLowerCase();
          return name.includes(q) || username.includes(q) || id.includes(q);
        });
        renderUserList(filtered);
      });
    }

    if (xpBtn && xpInput) xpBtn.addEventListener('click', () => applyAdjust('xp', xpInput.value));
    if (moneyBtn && moneyInput) moneyBtn.addEventListener('click', () => applyAdjust('money', moneyInput.value));
  }

  function init() {
    bind();
    updateAdminButtonVisibility();
    if (window.Auth && window.Auth.updateUI) {
      const orig = window.Auth.updateUI;
      window.Auth.updateUI = function () {
        orig.apply(window.Auth);
        updateAdminButtonVisibility();
      };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.AdminPanel = { openModal, closeModal, updateAdminButtonVisibility, openLogsModal, closeLogsModal };
})();

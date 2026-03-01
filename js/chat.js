/**
 * Chat panel (left): open/close with smooth transition, show name - role, text, timestamp.
 */
(function () {
  const API = '/api';
  const wrap = document.getElementById('chatPanelWrap');
  const toggleBtn = document.getElementById('chatToggle');
  const closeBtn = document.getElementById('chatPanelClose');
  const messagesEl = document.getElementById('chatMessages');
  const inputEl = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const muteMsgEl = document.getElementById('chatMuteMsg');
  const muteMsgTextEl = document.getElementById('chatMuteMsgText');
  const muteMsgDismissEl = document.getElementById('chatMuteMsgDismiss');
  let muteCheckTimer = null;
  let messagePollTimer = null;
  let globalMessagePollTimer = null;
  let delayClearTimer = null;
  /** Mute expiry from last 403 (admin or rate-limit). Client keeps this so we don't clear message until server says unmuted or this time has passed. */
  let effectiveMutedUntil = 0;
  /** Last mute message text shown (so refresh can re-apply if needed without overwriting). */
  let lastMuteMessageText = '';
  /** null = not fetched, true/false = from server or after accept */
  let chatRulesAcceptedCache = null;
  let rulesCountdownTimer = null;
  const RULES_COUNTDOWN_SEC = 3;

  function getAuthHeaders() {
    return window.Auth && window.Auth.getAuthHeaders ? window.Auth.getAuthHeaders() : {};
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  var ROLE_LABELS = { member: 'Member', mod: 'Mod', admin: 'Admin', owner: 'Owner' };

  function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.setAttribute('data-time', msg.time);
    const name = escapeHtml(msg.displayName || msg.username || '?');
    const text = escapeHtml(msg.text);
    const time = formatTime(msg.time);
    const role = (msg.role && ['member', 'mod', 'admin', 'owner'].includes(msg.role)) ? msg.role : null;
    const roleLabel = role ? escapeHtml(ROLE_LABELS[role] || role) : '';
    const roleClass = role ? ' profile-role-tag--' + role : '';
    const roleHtml = role
      ? '<span class="profile-role-tag profile-role-tag' + roleClass + '">' + roleLabel + '</span>'
      : '';
    const slug = (msg.profileSlug || '').trim();
    const nameHtml = slug
      ? '<a href="#profile/' + escapeHtml(slug) + '" class="chat-msg-name chat-msg-name-link">' + name + '</a>'
      : '<span class="chat-msg-name">' + name + '</span>';
    div.innerHTML =
      '<div class="chat-msg-header">' +
        nameHtml +
        roleHtml +
        '<span class="chat-msg-time">' + time + '</span>' +
      '</div>' +
      '<div class="chat-msg-text">' + text + '</div>';
    return div;
  }

  function renderMessages(messages, options) {
    if (!messagesEl) return;
    const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
    const forceScrollBottom = options && options.forceScrollBottom;
    messagesEl.innerHTML = '';
    (messages || []).forEach((msg) => {
      messagesEl.appendChild(renderMessage(msg));
    });
    if (forceScrollBottom || wasAtBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  const CHAT_DISPLAY_LIMIT = 25;

  async function loadMessages() {
    try {
      const res = await fetch(API + '/chat');
      const data = await res.json().catch(() => ({}));
      const all = data.messages || [];
      const toShow = all.length <= CHAT_DISPLAY_LIMIT ? all : all.slice(-CHAT_DISPLAY_LIMIT);
      renderMessages(toShow, { forceScrollBottom: false });
    } catch (e) {
      console.warn('Chat load failed:', e.message);
      renderMessages([]);
    }
  }

  function formatMutedUntil(ts) {
    return new Date(ts).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  }

  function hideMessage() {
    if (muteMsgTextEl) muteMsgTextEl.textContent = '';
    if (muteMsgEl) muteMsgEl.classList.add('hidden');
  }

  function updateMuteUI(mutedUntil, messageText) {
    const now = Date.now();
    const effectiveUntil = mutedUntil != null ? mutedUntil : effectiveMutedUntil;
    const muted = effectiveUntil > now;
    if (inputEl) inputEl.disabled = muted;
    if (sendBtn) sendBtn.disabled = muted;
    if (messageText !== undefined && messageText !== null && messageText !== '') {
      lastMuteMessageText = messageText;
      if (muteMsgTextEl) muteMsgTextEl.textContent = messageText;
      if (muteMsgEl) muteMsgEl.classList.remove('hidden');
    } else if (!muted) {
      effectiveMutedUntil = 0;
      lastMuteMessageText = '';
      hideMessage();
    } else if (lastMuteMessageText) {
      if (muteMsgTextEl) muteMsgTextEl.textContent = lastMuteMessageText;
      if (muteMsgEl) muteMsgEl.classList.remove('hidden');
    }
  }

  async function refreshMuteState() {
    if (!isPanelOpen() || !window.Auth || !window.Auth.getAuthHeaders) return;
    try {
      const res = await fetch(API + '/user/stats', { headers: getAuthHeaders() });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const now = Date.now();
      const serverUntil = data.chatMutedUntil != null ? Number(data.chatMutedUntil) : null;
      const stillMutedByServer = serverUntil != null && serverUntil > now;
      const stillMutedByClient = effectiveMutedUntil > now;
      if (stillMutedByServer || stillMutedByClient) {
        const useUntil = Math.max(serverUntil || 0, effectiveMutedUntil);
        updateMuteUI(useUntil);
      } else {
        effectiveMutedUntil = 0;
        updateMuteUI(null);
      }
    } catch (e) {
      if (effectiveMutedUntil <= Date.now()) {
        effectiveMutedUntil = 0;
        updateMuteUI(null);
      } else {
        updateMuteUI(effectiveMutedUntil);
      }
    }
  }

  function openPanel() {
    if (wrap) {
      wrap.classList.remove('chat-panel-wrap--closed');
      if (toggleBtn) toggleBtn.setAttribute('title', 'Close chat');
      if (toggleBtn) toggleBtn.setAttribute('aria-label', 'Close chat');
      loadMessages();
      refreshMuteState();
      if (muteCheckTimer) clearInterval(muteCheckTimer);
      muteCheckTimer = setInterval(refreshMuteState, 2000);
      if (messagePollTimer) clearInterval(messagePollTimer);
      messagePollTimer = setInterval(loadMessages, 500);
    }
  }

  function closePanel() {
    if (wrap) {
      wrap.classList.add('chat-panel-wrap--closed');
      if (toggleBtn) toggleBtn.setAttribute('title', 'Open chat');
      if (toggleBtn) toggleBtn.setAttribute('aria-label', 'Open chat');
      if (muteCheckTimer) { clearInterval(muteCheckTimer); muteCheckTimer = null; }
      if (messagePollTimer) { clearInterval(messagePollTimer); messagePollTimer = null; }
      if (delayClearTimer) { clearTimeout(delayClearTimer); delayClearTimer = null; }
      hideMessage();
      lastMuteMessageText = '';
    }
  }

  function isPanelOpen() {
    return wrap && !wrap.classList.contains('chat-panel-wrap--closed');
  }

  async function sendMessage() {
    const text = (inputEl && inputEl.value || '').trim();
    if (!text) return;
    if (!window.Auth || !window.Auth.isAuthenticated || !window.Auth.isAuthenticated()) {
      if (window.Auth && window.Auth.showLoginModal) window.Auth.showLoginModal();
      return;
    }
    sendBtn.disabled = true;
    let res, data;
    try {
      res = await fetch(API + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ text }),
      });
      data = await res.json().catch(() => ({}));
      if (res.ok && data.message) {
        updateMuteUI(null);
        inputEl.value = '';
        messagesEl.appendChild(renderMessage(data.message));
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else {
        if (res.status === 403 && (data.code === 'CHAT_MUTED' || data.code === 'CHAT_RATE_MUTED')) {
          const until = data.mutedUntil != null ? Number(data.mutedUntil) : null;
          if (until != null) effectiveMutedUntil = until;
          updateMuteUI(until, data.error || (until ? 'Muted until ' + formatMutedUntil(until) : ''));
        } else if (res.status === 429) {
          updateMuteUI(null, "Don't spam");
          const ms = data.retryAfterMs != null ? Math.min(10000, Number(data.retryAfterMs)) : 2000;
          if (delayClearTimer) clearTimeout(delayClearTimer);
          delayClearTimer = setTimeout(function () {
            delayClearTimer = null;
            hideMessage();
          }, ms);
        } else {
          updateMuteUI(null, data.error || 'Send failed.');
          if (delayClearTimer) clearTimeout(delayClearTimer);
          delayClearTimer = setTimeout(function () {
            delayClearTimer = null;
            if (!effectiveMutedUntil || Date.now() >= effectiveMutedUntil) hideMessage();
          }, 3000);
        }
      }
    } catch (e) {
      console.warn('Chat send error:', e.message);
    } finally {
      if (!(res && res.status === 403 && (data && (data.code === 'CHAT_RATE_MUTED' || data.code === 'CHAT_MUTED')))) {
        refreshMuteState();
      }
    }
  }

  async function fetchChatRulesAccepted() {
    try {
      const res = await fetch(API + '/user/stats', { headers: getAuthHeaders() });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      return !!data.chatRulesAccepted;
    } catch (e) {
      return false;
    }
  }

  function showRulesOverlay() {
    const overlay = document.getElementById('chatRulesOverlay');
    const acceptBtn = document.getElementById('chatRulesAcceptBtn');
    const acceptLabel = document.getElementById('chatRulesAcceptLabel');
    if (!overlay || !acceptBtn || !acceptLabel) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    acceptBtn.disabled = true;
    acceptBtn.classList.add('chat-rules-accept-btn--locked');
    let left = RULES_COUNTDOWN_SEC;
    acceptLabel.textContent = 'Accept (' + left + 's)';
    if (rulesCountdownTimer) clearInterval(rulesCountdownTimer);
    rulesCountdownTimer = setInterval(function () {
      left -= 1;
      if (left > 0) {
        acceptLabel.textContent = 'Accept (' + left + 's)';
      } else {
        clearInterval(rulesCountdownTimer);
        rulesCountdownTimer = null;
        acceptLabel.textContent = 'Accept';
        acceptBtn.disabled = false;
        acceptBtn.classList.remove('chat-rules-accept-btn--locked');
      }
    }, 1000);
  }

  function hideRulesOverlay() {
    const overlay = document.getElementById('chatRulesOverlay');
    const acceptBtn = document.getElementById('chatRulesAcceptBtn');
    const acceptLabel = document.getElementById('chatRulesAcceptLabel');
    if (rulesCountdownTimer) {
      clearInterval(rulesCountdownTimer);
      rulesCountdownTimer = null;
    }
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (acceptBtn) {
      acceptBtn.disabled = true;
      acceptBtn.classList.add('chat-rules-accept-btn--locked');
    }
    if (acceptLabel) acceptLabel.textContent = 'Accept (' + RULES_COUNTDOWN_SEC + 's)';
  }

  async function onAcceptRules(e) {
    const acceptBtn = document.getElementById('chatRulesAcceptBtn');
    if (!acceptBtn || acceptBtn.disabled) return;
    try {
      const res = await fetch(API + '/user/chat-rules-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      if (res.ok && window.Auth && window.Auth.user) {
        window.Auth.user.chatRulesAccepted = true;
      }
    } catch (err) {
      console.warn('Chat rules accept failed:', err.message);
    }
    chatRulesAcceptedCache = true;
    hideRulesOverlay();
  }

  function bind() {
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (isPanelOpen()) {
          closePanel();
        } else {
          if (!window.Auth || !window.Auth.isAuthenticated()) {
            if (window.Auth && window.Auth.showLoginModal) window.Auth.showLoginModal();
            return;
          }
          openPanel();
        }
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closePanel);
    if (muteMsgDismissEl) muteMsgDismissEl.addEventListener('click', hideMessage);
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (inputEl) {
      inputEl.addEventListener('focus', async function () {
        if (!window.Auth || !window.Auth.isAuthenticated()) return;
        if (chatRulesAcceptedCache === null && window.Auth.user && window.Auth.user.chatRulesAccepted === true) {
          chatRulesAcceptedCache = true;
        }
        if (chatRulesAcceptedCache === null) {
          chatRulesAcceptedCache = await fetchChatRulesAccepted();
          if (window.Auth && window.Auth.user) window.Auth.user.chatRulesAccepted = chatRulesAcceptedCache;
        }
        if (!chatRulesAcceptedCache) {
          inputEl.blur();
          showRulesOverlay();
        }
      });
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    const rulesClose = document.getElementById('chatRulesClose');
    const rulesAccept = document.getElementById('chatRulesAcceptBtn');
    if (rulesClose) rulesClose.addEventListener('click', hideRulesOverlay);
    if (rulesAccept) {
      rulesAccept.addEventListener('click', function (e) {
        e.preventDefault();
        onAcceptRules(e);
      });
    }
  }

  function init() {
    bind();
    if (globalMessagePollTimer) clearInterval(globalMessagePollTimer);
    globalMessagePollTimer = setInterval(loadMessages, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Chat = { openPanel, closePanel, loadMessages, isPanelOpen };
})();

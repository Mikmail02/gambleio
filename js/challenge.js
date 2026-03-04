/**
 * Challenge system: duel invites, modal, invite banner, server messages.
 */
(function () {
  const API = '/api';
  const modal = document.getElementById('challengeModal');
  const modalBackdrop = document.getElementById('challengeModalBackdrop');
  const modalClose = document.getElementById('challengeModalClose');
  const modalTarget = document.getElementById('challengeModalTarget');
  const challengeSendBtn = document.getElementById('challengeSendBtn');
  const challengeBtnProfile = document.getElementById('challengeBtnProfile');
  const challengeWagerMoney = document.getElementById('challengeWagerMoney');
  const challengeWagerLock = document.getElementById('challengeWagerLock');
  const challengeMoneyInput = document.getElementById('challengeMoneyInput');
  const challengeLockMinutes = document.getElementById('challengeLockMinutes');
  const inviteBanner = document.getElementById('challengeInviteBanner');
  const inviteText = document.getElementById('challengeInviteText');
  const inviteAccept = document.getElementById('challengeInviteAccept');
  const inviteDecline = document.getElementById('challengeInviteDecline');

  let pendingChallenge = null;
  let pendingPollTimer = null;

  function getAuthHeaders() {
    return window.Auth && window.Auth.getAuthHeaders ? window.Auth.getAuthHeaders() : {};
  }

  function openModal(targetUsername, targetDisplayName) {
    if (!modal || !modalTarget) return;
    modalTarget.textContent = 'Challenge ' + (targetDisplayName || targetUsername || '—');
    modal.dataset.targetUsername = targetUsername || '';
    modal.dataset.targetDisplayName = targetDisplayName || '';
    challengeMoneyInput.value = '100';
    challengeLockMinutes.value = '5';
    document.querySelector('input[name="challengeWager"][value="money"]')?.click();
    toggleWagerInputs();
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  function closeModal() {
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  function toggleWagerInputs() {
    const isMoney = document.querySelector('input[name="challengeWager"]:checked')?.value === 'money';
    if (challengeWagerMoney) challengeWagerMoney.classList.toggle('hidden', !isMoney);
    if (challengeWagerLock) challengeWagerLock.classList.toggle('hidden', isMoney);
  }

  async function sendChallenge() {
    const targetUsername = modal?.dataset.targetUsername;
    if (!targetUsername) return;
    if (!window.Auth || !window.Auth.isAuthenticated?.()) {
      if (window.Auth?.showLoginModal) window.Auth.showLoginModal();
      return;
    }

    const wagerType = document.querySelector('input[name="challengeWager"]:checked')?.value || 'money';
    let wagerValue;
    if (wagerType === 'money') {
      const amt = parseInt(challengeMoneyInput?.value || '0', 10);
      if (!Number.isFinite(amt) || amt < 1) {
        alert('Enter a valid amount (min 1)');
        return;
      }
      wagerValue = amt;
    } else {
      const min = Math.min(10, Math.max(1, parseInt(challengeLockMinutes?.value || '5', 10)));
      wagerValue = min;
    }

    challengeSendBtn.disabled = true;
    try {
      const res = await fetch(API + '/challenge/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          targetUsername,
          wagerType,
          wagerValue,
          game: 'gambly_bird',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.challenge) {
        closeModal();
        if (window.Chat?.loadMessages) window.Chat.loadMessages();
      } else {
        alert(data.error || 'Failed to send challenge');
      }
    } catch (e) {
      console.error('Challenge send error:', e);
      alert('Failed to send challenge');
    } finally {
      challengeSendBtn.disabled = false;
    }
  }

  async function fetchPendingChallenge() {
    if (!window.Auth?.isAuthenticated?.()) return null;
    try {
      const res = await fetch(API + '/challenge/pending', { headers: getAuthHeaders() });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return data.challenge || null;
    } catch (e) {
      return null;
    }
  }

  function showInviteBanner(challenge) {
    if (!inviteBanner || !inviteText || !challenge) return;
    const challenger = challenge.challengerDisplayName || challenge.challengerUsername || 'Someone';
    const wagerStr = challenge.wagerType === 'money'
      ? '$' + (challenge.wagerValue || 0).toLocaleString()
      : 'Gamble Lock ' + (challenge.wagerValue || 0) + ' min';
    const gameStr = challenge.game === 'gambly_bird' ? 'Gambly Bird' : (challenge.game || 'Gambly Bird');
    inviteText.textContent = challenger + ' challenged you! Wager: ' + wagerStr + ' • Game: ' + gameStr;
    inviteBanner.dataset.challengeId = challenge.id || '';
    inviteBanner.classList.remove('hidden');
  }

  function hideInviteBanner() {
    if (inviteBanner) {
      inviteBanner.classList.add('hidden');
      inviteBanner.dataset.challengeId = '';
    }
    pendingChallenge = null;
  }

  async function acceptChallenge() {
    const id = inviteBanner?.dataset.challengeId;
    if (!id) return;
    inviteAccept.disabled = true;
    inviteDecline.disabled = true;
    try {
      const res = await fetch(API + '/challenge/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ challengeId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        hideInviteBanner();
        if (window.Chat?.loadMessages) window.Chat.loadMessages();
        const match = data.match || {};
        if (match.seed && match.startTime && window.GamblyBird) {
          window.GamblyBird.show(match.seed, match.startTime, id);
        }
      } else {
        alert(data.error || 'Failed to accept');
        inviteAccept.disabled = false;
        inviteDecline.disabled = false;
      }
    } catch (e) {
      inviteAccept.disabled = false;
      inviteDecline.disabled = false;
    }
  }

  async function fetchActiveMatch() {
    if (!window.Auth?.isAuthenticated?.()) return null;
    try {
      const res = await fetch(API + '/challenge/active-match', { headers: getAuthHeaders() });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return data.challengeId ? data : null;
    } catch (e) {
      return null;
    }
  }

  async function submitGamblyResult(challengeId, jumpTimestamps) {
    try {
      const res = await fetch(API + '/challenge/submit-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ challengeId, jumpTimestamps }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.bothDone && window.Chat?.loadMessages) window.Chat.loadMessages();
      return res.ok ? data : null;
    } catch (e) {
      console.error('Submit result error:', e);
      return null;
    }
  }

  async function pollChallengeResult(challengeId) {
    try {
      const res = await fetch(API + '/challenge/' + encodeURIComponent(challengeId) + '/result', { headers: getAuthHeaders() });
      if (!res.ok) return null;
      return await res.json().catch(() => ({}));
    } catch (e) {
      return null;
    }
  }

  async function declineChallenge() {
    const id = inviteBanner?.dataset.challengeId;
    if (!id) return;
    inviteAccept.disabled = true;
    inviteDecline.disabled = true;
    try {
      const res = await fetch(API + '/challenge/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ challengeId: id }),
      });
      if (res.ok) {
        hideInviteBanner();
        if (window.Chat?.loadMessages) window.Chat.loadMessages();
      }
      inviteAccept.disabled = false;
      inviteDecline.disabled = false;
    } catch (e) {
      inviteAccept.disabled = false;
      inviteDecline.disabled = false;
    }
  }

  async function pollPending() {
    const c = await fetchPendingChallenge();
    if (c && c.id) {
      pendingChallenge = c;
      showInviteBanner(c);
    } else {
      if (pendingChallenge) hideInviteBanner();
    }
    const match = await fetchActiveMatch();
    if (match && match.challengeId && match.seed && match.startTime && window.GamblyBird) {
      const overlay = document.getElementById('gamblyBirdOverlay');
      if (overlay && overlay.classList.contains('hidden')) {
        window.GamblyBird.show(match.seed, match.startTime, match.challengeId);
      }
    }
  }

  function bind() {
    document.querySelectorAll('input[name="challengeWager"]').forEach((r) => {
      r.addEventListener('change', toggleWagerInputs);
    });
    if (challengeBtnProfile) {
      challengeBtnProfile.addEventListener('click', () => {
        const username = challengeBtnProfile.dataset.profileUsername;
        const slug = challengeBtnProfile.dataset.profileSlug;
        const displayName = document.getElementById('profileName')?.textContent || username;
        if (username) openModal(username, displayName);
      });
    }
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
    if (challengeSendBtn) challengeSendBtn.addEventListener('click', sendChallenge);
    if (inviteAccept) inviteAccept.addEventListener('click', acceptChallenge);
    if (inviteDecline) inviteDecline.addEventListener('click', declineChallenge);
  }

  function init() {
    bind();
    if (pendingPollTimer) clearInterval(pendingPollTimer);
    pendingPollTimer = setInterval(pollPending, 2000);
    pollPending();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Challenge = { openModal, closeModal, showInviteBanner, hideInviteBanner, pollPending, submitGamblyResult, pollChallengeResult };
})();

/**
 * Authentication: Simple local auth with email/password (localStorage).
 * When server is used, token is stored and balance/stats are synced from server.
 */
(function () {
  const API_BASE = '/api';
  let currentUser = null;
  let isLoginMode = true;

  function getToken() {
    return localStorage.getItem('gambleio_token');
  }

  function getAuthHeaders() {
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function isAuthenticated() {
    return !!currentUser && !!getToken();
  }

  function loadUser() {
    const userStr = localStorage.getItem('gambleio_user');
    if (userStr) {
      try {
        currentUser = JSON.parse(userStr);
        if (window.Auth) window.Auth.user = currentUser;
        updateUI();
      } catch (e) {
        localStorage.removeItem('gambleio_user');
      }
    }
  }

  function saveUser(user) {
    if (user) {
      localStorage.setItem('gambleio_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('gambleio_user');
    }
  }

  function showError(message) {
    const authError = document.getElementById('authError');
    if (authError) {
      authError.textContent = message;
      authError.classList.remove('hidden');
    }
  }

  function hideError() {
    const authError = document.getElementById('authError');
    if (authError) {
      authError.classList.add('hidden');
    }
  }

  function showLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      hideError();
      setTimeout(() => {
        const emailInput = document.getElementById('email');
        if (emailInput) emailInput.focus();
      }, 50);
    }
  }

  function hideLoginModal() {
    const modal = document.getElementById('loginModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      const form = document.getElementById('authForm');
      if (form) form.reset();
      hideError();
    }
  }

  function updateUI() {
    const loginBtn = document.getElementById('loginBtn');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');

    if (currentUser) {
      if (loginBtn) loginBtn.classList.add('hidden');
      if (userInfo) userInfo.classList.remove('hidden');
      if (userName) userName.textContent = currentUser.displayName || currentUser.email || 'User';
      if (userAvatar) {
        userAvatar.src = currentUser.photoURL || '';
        userAvatar.style.display = currentUser.photoURL ? 'block' : 'none';
      }
      updateProfileUI();
      refreshRankBadge();
    } else {
      if (loginBtn) loginBtn.classList.remove('hidden');
      if (userInfo) userInfo.classList.add('hidden');
    }
  }

  function updateProfileUI() {
    if (!currentUser) return;
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileAvatar = document.getElementById('profileAvatar');
    const logoutBtnProfile = document.getElementById('logoutBtnProfile');
    const viewingOwnProfile = window.location && window.location.hash === '#profile';

    if (profileName) profileName.textContent = currentUser.displayName || currentUser.email || 'User';
    if (profileEmail) profileEmail.textContent = currentUser.email || '';
    if (profileAvatar) {
      profileAvatar.src = currentUser.photoURL || '';
      profileAvatar.style.display = currentUser.photoURL ? 'block' : 'none';
    }
    updateProfileStats();
    if (logoutBtnProfile) {
      logoutBtnProfile.style.display = viewingOwnProfile ? 'block' : 'none';
    }
  }

  function updateProfileStats() {
    if (!window.Game) return;
    const formatDollars = (n) => '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
    const formatNum = (n) => new Intl.NumberFormat('en').format(n);
    const profileBalance = document.getElementById('profileBalance');
    const profileTotalBets = document.getElementById('profileTotalBets');
    const profileTotalWon = document.getElementById('profileTotalWon');
    const profileXp = document.getElementById('profileXp');
    const profileRankLevel = document.getElementById('profileRankLevel');

    if (profileBalance) {
      profileBalance.textContent = formatDollars(Game.getBalance());
    }
    if (profileXp && Game.getXp) {
      profileXp.textContent = formatNum(Game.getXp());
    }
    if (profileRankLevel && Game.getCurrentLevel) {
      profileRankLevel.textContent = `Lv ${Game.getCurrentLevel()}`;
    }
    if (profileTotalBets) {
      profileTotalBets.textContent = Game.getTotalBets().toLocaleString();
    }
    if (profileTotalWon) {
      profileTotalWon.textContent = formatDollars(Game.getTotalWon());
    }
    refreshRankBadge();
  }

  function renderRankBadge(el, rank, progress, ids, isProfile) {
    if (!el || !ids) return;
    const inLevel = Math.max(0, progress.inLevel || 0);
    const needed = Math.max(1, progress.needed || 1000);
    const left = Math.max(0, needed - inLevel);
    const pct = rank.isMaxRank ? 100 : Math.max(0, Math.min(100, (inLevel / needed) * 100));
    const progressText = rank.isMaxRank
      ? (isProfile ? `MAX RANK • Lv ${rank.level}` : 'MAX RANK')
      : `${new Intl.NumberFormat('en').format(inLevel)} / ${new Intl.NumberFormat('en').format(needed)} XP • ${new Intl.NumberFormat('en').format(left)} left`;
    const labelEl = document.getElementById(ids.labelId);
    const levelEl = document.getElementById(ids.levelId);
    const fillEl = document.getElementById(ids.fillId);
    const textEl = document.getElementById(ids.textId);
    if (labelEl) labelEl.textContent = rank.label;
    if (levelEl) levelEl.textContent = rank.isMaxRank ? `MAX RANK • Lv ${rank.level}` : `Lv ${rank.level}`;
    if (fillEl) fillEl.style.width = `${pct}%`;
    if (textEl) textEl.textContent = progressText;
  }

  function refreshRankBadge() {
    if (!window.Game || !Game.getRankInfo) return;
    const rank = Game.getRankInfo();
    const progress = Game.getXpProgressInLevel ? Game.getXpProgressInLevel() : { inLevel: 0, needed: 1000 };
    const headerBadge = document.getElementById('headerRankBadge');
    const headerLevelText = document.getElementById('headerLevelText');
    const headerLevelFill = document.getElementById('headerLevelProgressFill');
    const headerLevelProgressText = document.getElementById('headerLevelProgressText');
    const profileBadge = document.getElementById('profileRankBadge');
    const className = `rank-badge rank-tier ${rank.badgeClass}`;
    const inLevel = Math.max(0, progress.inLevel || 0);
    const needed = Math.max(1, progress.needed || 1000);
    const left = Math.max(0, needed - inLevel);
    const pct = rank.isMaxRank ? 100 : Math.max(0, Math.min(100, (inLevel / needed) * 100));
    const progressText = rank.isMaxRank
      ? 'MAX RANK'
      : `${new Intl.NumberFormat('en').format(inLevel)} / ${new Intl.NumberFormat('en').format(needed)} XP • ${new Intl.NumberFormat('en').format(left)} left`;

    if (headerLevelText) headerLevelText.textContent = `Lv ${rank.level}`;
    if (headerLevelFill) headerLevelFill.style.width = `${pct}%`;
    if (headerLevelProgressText) headerLevelProgressText.textContent = progressText;

    if (headerBadge) {
      headerBadge.className = `${className} rank-badge--header`;
      headerBadge.textContent = rank.label;
      headerBadge.title = rank.isMaxRank ? 'Maximum rank reached' : 'Rank badge';
    }
    if (profileBadge) {
      profileBadge.className = `${className} rank-badge--profile`;
      renderRankBadge(profileBadge, rank, progress, {
        labelId: 'profileRankLabel',
        levelId: 'profileRankLevelBadge',
        fillId: '',
        textId: '',
      }, true);
      profileBadge.title = rank.isMaxRank ? 'Maximum rank reached' : 'Rank badge';
    }
  }

  function updateBalance() {
    const balanceEl = document.getElementById('balance');
    if (balanceEl && window.Game) {
      const formatDollars = (n) => '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
      balanceEl.textContent = formatDollars(Game.getBalance());
    }
    refreshRankBadge();
  }

  function requireAuth(callback) {
    if (!currentUser) {
      showLoginModal();
      return false;
    }
    if (callback) callback();
    return true;
  }

  async function signInWithEmail(email, password) {
    const users = JSON.parse(localStorage.getItem('gambleio_users') || '{}');
    const userKey = email.toLowerCase();
    if (!users[userKey]) {
      showError('User not found. Please sign up first.');
      return;
    }
    if (users[userKey].password !== password) {
      showError('Incorrect password.');
      return;
    }
    currentUser = {
      uid: users[userKey].uid,
      email: users[userKey].email,
      displayName: users[userKey].displayName,
      photoURL: users[userKey].photoURL || null,
      username: email.toLowerCase(),
    };
    saveUser(currentUser);
    if (window.Auth) window.Auth.user = currentUser;
    try {
      const res = await fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email.toLowerCase(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('gambleio_token', data.token);
        if (window.Stats && window.Stats.loadStats) await window.Stats.loadStats();
      }
    } catch (e) {
      console.warn('Server login skipped:', e.message);
    }
    updateUI();
    hideLoginModal();
    if (window.Auth && window.Auth.onAuthStateChanged) {
      window.Auth.onAuthStateChanged(currentUser);
    }
  }

  async function signUpWithEmail(email, password, username) {
    const users = JSON.parse(localStorage.getItem('gambleio_users') || '{}');
    const userKey = email.toLowerCase();
    if (users[userKey]) {
      showError('Email already registered. Please login instead.');
      return;
    }
    if (password.length < 6) {
      showError('Password must be at least 6 characters.');
      return;
    }
    const uid = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    users[userKey] = {
      uid,
      email: email.toLowerCase(),
      password,
      displayName: username || email.split('@')[0],
      photoURL: null,
    };
    localStorage.setItem('gambleio_users', JSON.stringify(users));
    currentUser = {
      uid,
      email: email.toLowerCase(),
      displayName: username || email.split('@')[0],
      photoURL: null,
      username: email.toLowerCase(),
    };
    saveUser(currentUser);
    if (window.Auth) window.Auth.user = currentUser;
    try {
      const res = await fetch(API_BASE + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email.toLowerCase(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('gambleio_token', data.token);
        if (window.Stats && window.Stats.loadStats) await window.Stats.loadStats();
      }
    } catch (e) {
      console.warn('Server register skipped:', e.message);
    }
    updateUI();
    hideLoginModal();
    if (window.Auth && window.Auth.onAuthStateChanged) {
      window.Auth.onAuthStateChanged(currentUser);
    }
  }

  function logout() {
    currentUser = null;
    if (window.Auth) window.Auth.user = null;
    saveUser(null);
    localStorage.removeItem('gambleio_token');
    updateUI();
    if (window.Auth && window.Auth.onAuthStateChanged) {
      window.Auth.onAuthStateChanged(null);
    }
  }

  function switchTab(mode) {
    isLoginMode = mode === 'login';
    const authTabs = document.querySelectorAll('.auth-tab');
    const usernameGroup = document.getElementById('usernameGroup');
    const authSubmit = document.getElementById('authSubmit');

    if (authTabs && authTabs.length > 0) {
      authTabs.forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === mode);
      });
    }
    if (usernameGroup) usernameGroup.style.display = isLoginMode ? 'none' : 'block';
    if (authSubmit) authSubmit.textContent = isLoginMode ? 'Login' : 'Sign Up';
    hideError();
  }

  async function init() {
    loadUser();
    if (currentUser && getToken() && window.Stats && window.Stats.loadStats) {
      try {
        await window.Stats.loadStats();
      } catch (e) {
        console.warn('Load stats on init:', e.message);
      }
    }
    updateUI();

    // Login button - simple click handler
    document.addEventListener('click', function(e) {
      if (e.target && (e.target.id === 'loginBtn' || e.target.classList.contains('btn-login'))) {
        e.preventDefault();
        showLoginModal();
      }
    });

    // Close modal button
    document.addEventListener('click', function(e) {
      if (e.target && (e.target.id === 'closeLoginModal' || e.target.classList.contains('modal-close'))) {
        e.preventDefault();
        hideLoginModal();
      }
    });

    // Modal background click
    const loginModal = document.getElementById('loginModal');
    if (loginModal) {
      loginModal.addEventListener('click', function(e) {
        if (e.target === loginModal) {
          hideLoginModal();
        }
      });
    }

    // Auth tabs
    document.addEventListener('click', function(e) {
      if (e.target && e.target.classList.contains('auth-tab')) {
        const mode = e.target.getAttribute('data-tab');
        if (mode) switchTab(mode);
      }
    });

    // Auth form submit
    const authForm = document.getElementById('authForm');
    if (authForm) {
      authForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        hideError();
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        const usernameInput = document.getElementById('username');

        const email = emailInput ? emailInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';
        const username = usernameInput ? usernameInput.value.trim() : '';

        if (!email || !password) {
          showError('Please fill in all fields.');
          return;
        }
        if (isLoginMode) {
          await signInWithEmail(email, password);
        } else {
          await signUpWithEmail(email, password, username);
        }
      });
    }

    // User name click to profile
    document.addEventListener('click', function(e) {
      if (e.target && (e.target.id === 'userName' || e.target.classList.contains('user-name'))) {
        if (window.showPage) {
          window.showPage('profile');
          updateProfileUI();
        }
      }
    });

    // Logout button
    document.addEventListener('click', function(e) {
      if (e.target && (e.target.id === 'logoutBtnProfile' || e.target.classList.contains('btn-logout-profile'))) {
        logout();
      }
    });
  }

  window.Auth = {
    requireAuth,
    showLoginModal,
    getCurrentUser: () => currentUser,
    getAuthHeaders,
    isAuthenticated,
    user: null,
    updateProfileBalance: () => {
      updateBalance();
      updateProfileStats();
    },
    updateProfileStats,
    updateBalance,
    refreshRankBadge,
    onAuthStateChanged: null,
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Update profile balance periodically
  setInterval(() => {
    if (currentUser && window.Game) {
      updateBalance();
      updateProfileStats();
    }
  }, 1000);
})();

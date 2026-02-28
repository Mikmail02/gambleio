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

  function isViewingOwnProfile() {
    const hash = (window.location && window.location.hash) || '';
    if (hash === '#profile') return true;
    if (hash.startsWith('#profile/') && currentUser) {
      const slug = hash.slice(hash.indexOf('/') + 1);
      return (currentUser.username || '').toLowerCase() === slug.toLowerCase() ||
             (currentUser.profileSlug || '').toLowerCase() === slug.toLowerCase();
    }
    return false;
  }

  function updateProfileUI() {
    if (!currentUser) return;
    if (!isViewingOwnProfile()) return;
    const profileName = document.getElementById('profileName');
    const profileAvatar = document.getElementById('profileAvatar');
    const logoutBtnProfile = document.getElementById('logoutBtnProfile');
    const hash = (window.location && window.location.hash) || '';
    const viewingOwnProfile = hash === '#profile' || (hash.startsWith('#profile/') && currentUser && hash.slice(9).toLowerCase() === (currentUser.username || '').toLowerCase());

    if (profileName) profileName.textContent = currentUser.displayName || currentUser.username || 'User';
    if (profileAvatar) {
      profileAvatar.src = currentUser.photoURL || '';
      profileAvatar.style.display = currentUser.photoURL ? 'block' : 'none';
    }
    updateProfileStats();
    if (logoutBtnProfile) {
      logoutBtnProfile.style.display = viewingOwnProfile ? 'block' : 'none';
    }
    const balanceStat = document.getElementById('profileBalanceStat');
    if (balanceStat) balanceStat.style.display = viewingOwnProfile ? '' : 'none';
    const crown = document.getElementById('profileOwnerCrown');
    const ownerTag = document.getElementById('profileOwnerTag');
    if (crown) crown.classList.toggle('hidden', !(currentUser && currentUser.isOwner));
    if (ownerTag) ownerTag.classList.toggle('hidden', !(currentUser && currentUser.isOwner));
  }

  function renderProfileForUser(user) {
    const profileName = document.getElementById('profileName');
    const profileAvatar = document.getElementById('profileAvatar');
    const profileBalance = document.getElementById('profileBalance');
    const profileBalanceStat = document.getElementById('profileBalanceStat');
    const profileTotalBets = document.getElementById('profileTotalBets');
    const profileTotalWon = document.getElementById('profileTotalWon');
    const profileXp = document.getElementById('profileXp');
    const profileRankLevel = document.getElementById('profileRankLevel');
    const logoutBtnProfile = document.getElementById('logoutBtnProfile');
    const profileBadge = document.getElementById('profileRankBadge');

    if (profileName) profileName.textContent = user.displayName || user.username || 'User';
    if (profileAvatar) {
      profileAvatar.src = user.photoURL || '';
      profileAvatar.style.display = (user.photoURL ? 'block' : 'none');
    }
    if (profileBalanceStat) profileBalanceStat.style.display = 'none';
    if (logoutBtnProfile) logoutBtnProfile.style.display = 'none';

    const formatDollars = (n) => '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
    const formatNum = (n) => new Intl.NumberFormat('en').format(n);

    if (profileXp) profileXp.textContent = formatNum(user.xp || 0);
    if (profileRankLevel) profileRankLevel.textContent = `Lv ${user.level || 1}`;
    if (profileTotalBets) profileTotalBets.textContent = formatNum(user.totalBets || 0);
    if (profileTotalWon) profileTotalWon.textContent = formatDollars(user.totalGamblingWins || 0);

    if (window.Game && window.Game.getRankInfoForXp && profileBadge) {
      const rank = Game.getRankInfoForXp(user.xp);
      profileBadge.className = `rank-badge rank-tier rank-badge--profile ${rank.badgeClass}`;
      const labelEl = document.getElementById('profileRankLabel');
      const levelEl = document.getElementById('profileRankLevelBadge');
      if (labelEl) labelEl.textContent = rank.label;
      if (levelEl) levelEl.textContent = rank.isMaxRank ? `MAX RANK • Lv ${rank.level}` : `Lv ${rank.level}`;
    }
    const crown = document.getElementById('profileOwnerCrown');
    const ownerTag = document.getElementById('profileOwnerTag');
    if (crown) crown.classList.toggle('hidden', !user.isOwner);
    if (ownerTag) ownerTag.classList.toggle('hidden', !user.isOwner);
  }

  async function showProfile(profileUsername) {
    const navProfile = document.getElementById('navProfile');
    if (navProfile) {
      const display = profileUsername
        ? (profileUsername.charAt(0).toUpperCase() + profileUsername.slice(1).toLowerCase())
        : (currentUser ? (currentUser.displayName || currentUser.username || 'Profile') : 'Profile');
      navProfile.textContent = display;
    }

    if (!profileUsername) {
      if (currentUser) {
        updateProfileUI();
      } else {
        const profileName = document.getElementById('profileName');
        if (profileName) profileName.textContent = 'Log in to view your profile';
        document.getElementById('profileBalanceStat') && (document.getElementById('profileBalanceStat').style.display = 'none');
        document.getElementById('logoutBtnProfile') && (document.getElementById('logoutBtnProfile').style.display = 'none');
        document.getElementById('profileOwnerCrown')?.classList.add('hidden');
        document.getElementById('profileOwnerTag')?.classList.add('hidden');
      }
      return;
    }

    const currentSlug = (currentUser && (currentUser.profileSlug || currentUser.username)) || '';
    if (currentUser && (currentSlug.toLowerCase() === profileUsername.toLowerCase() || (currentUser.username || '').toLowerCase() === profileUsername.toLowerCase())) {
      updateProfileUI();
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/user/${encodeURIComponent(profileUsername)}/profile`);
      if (!res.ok) {
        const profileName = document.getElementById('profileName');
        if (profileName) profileName.textContent = 'User not found';
        document.getElementById('profileBalanceStat') && (document.getElementById('profileBalanceStat').style.display = 'none');
        document.getElementById('logoutBtnProfile') && (document.getElementById('logoutBtnProfile').style.display = 'none');
        document.getElementById('profileOwnerCrown')?.classList.add('hidden');
        document.getElementById('profileOwnerTag')?.classList.add('hidden');
        return;
      }
      const user = await res.json();
      renderProfileForUser(user);
    } catch (e) {
      console.error('Profile load error:', e);
      const profileName = document.getElementById('profileName');
      if (profileName) profileName.textContent = 'Could not load profile';
    }
  }

  function updateProfileStats() {
    if (!window.Game) return;
    if (!isViewingOwnProfile()) return;
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
    if (profileBadge && isViewingOwnProfile()) {
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
    const clickerPerClickEl = document.getElementById('clickerPerClick');
    if (clickerPerClickEl && window.Game) {
      clickerPerClickEl.textContent = '$' + Game.clickEarning;
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
    const emailKey = email.toLowerCase().trim();
    try {
      const res = await fetch(API_BASE + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: emailKey, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        currentUser = {
          uid: data.user?.username || emailKey,
          email: emailKey,
          displayName: data.user?.displayName || emailKey.split('@')[0],
          photoURL: null,
          username: emailKey,
          profileSlug: data.user?.profileSlug,
          isOwner: !!data.user?.isOwner,
        };
        saveUser(currentUser);
        if (window.Auth) window.Auth.user = currentUser;
        localStorage.setItem('gambleio_token', data.token);
        if (window.Stats && window.Stats.loadStats) await window.Stats.loadStats();
        updateUI();
        hideLoginModal();
        if (window.Auth && window.Auth.onAuthStateChanged) {
          window.Auth.onAuthStateChanged(currentUser);
        }
        return;
      }
      if (res.status === 401 && data.error) {
        if (data.error === 'User not found') {
          showError('Email not found. Please sign up first.');
        } else if (data.error === 'Wrong password') {
          showError('Incorrect password.');
        } else {
          showError(data.error || 'Invalid credentials.');
        }
        return;
      }
      if (res.status >= 400 && data.error) {
        showError(data.error || 'Login failed. Please try again.');
        return;
      }
    } catch (e) {
      console.warn('Server login failed:', e.message);
      showError('Could not connect to server. Make sure the server is running (node server.js).');
      return;
    }
    const users = JSON.parse(localStorage.getItem('gambleio_users') || '{}');
    if (!users[emailKey]) {
      showError('Email not found. Please sign up first.');
      return;
    }
    if (users[emailKey].password !== password) {
      showError('Incorrect password.');
      return;
    }
    currentUser = {
      uid: users[emailKey].uid,
      email: users[emailKey].email,
      displayName: users[emailKey].displayName,
      photoURL: users[emailKey].photoURL || null,
      username: emailKey,
    };
    saveUser(currentUser);
    if (window.Auth) window.Auth.user = currentUser;
    updateUI();
    hideLoginModal();
    if (window.Auth && window.Auth.onAuthStateChanged) {
      window.Auth.onAuthStateChanged(currentUser);
    }
  }

  async function signUpWithEmail(email, password, username) {
    if (password.length < 6) {
      showError('Password must be at least 6 characters.');
      return;
    }
    const emailKey = email.toLowerCase().trim();
    const displayName = (username || '').trim() || emailKey.split('@')[0];
    try {
      const res = await fetch(API_BASE + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: emailKey, password, displayName }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        currentUser = {
          uid: data.user?.username || emailKey,
          email: emailKey,
          displayName: data.user?.displayName || displayName,
          photoURL: null,
          username: emailKey,
          profileSlug: data.user?.profileSlug,
          isOwner: !!data.user?.isOwner,
        };
        saveUser(currentUser);
        if (window.Auth) window.Auth.user = currentUser;
        localStorage.setItem('gambleio_token', data.token);
        if (window.Stats && window.Stats.loadStats) await window.Stats.loadStats();
        updateUI();
        hideLoginModal();
        if (window.Auth && window.Auth.onAuthStateChanged) {
          window.Auth.onAuthStateChanged(currentUser);
        }
        return;
      }
      if (res.status === 400 && data.error) {
        showError(data.error === 'Username already exists' ? 'Email already registered. Please login instead.' : data.error);
        return;
      }
    } catch (e) {
      console.warn('Server register failed:', e.message);
      showError('Could not connect to server. Make sure the server is running (node server.js).');
      return;
    }
    showError('Registration failed. Please try again.');
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

    // Login button – direct handler for reliability
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showLoginModal();
      });
    }

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

    // Auth form submit + button click (both for reliability)
    function doAuthSubmit(e) {
      if (e) e.preventDefault();
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
        signInWithEmail(email, password);
      } else {
        signUpWithEmail(email, password, username);
      }
    }

    const authForm = document.getElementById('authForm');
    const authSubmitBtn = document.getElementById('authSubmit');
    if (authForm) {
      authForm.addEventListener('submit', function(e) {
        e.preventDefault();
        doAuthSubmit();
      });
    }
    if (authSubmitBtn) {
      authSubmitBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        doAuthSubmit();
      });
    }

    // User name click to own profile
    document.addEventListener('click', function(e) {
      if (e.target && (e.target.id === 'userName' || e.target.classList.contains('user-name'))) {
        window.location.hash = '#profile';
      }
    });

    // Logout button
    document.addEventListener('click', function(e) {
      if (e.target && (e.target.id === 'logoutBtnProfile' || e.target.classList.contains('btn-logout-profile'))) {
        logout();
      }
    });
  }

  function handleSessionExpired() {
    logout();
    showLoginModal();
    showError('Session expired. Please log in again.');
  }

  window.Auth = {
    requireAuth,
    showLoginModal,
    getCurrentUser: () => currentUser,
    getAuthHeaders,
    isAuthenticated,
    user: null,
    onSessionExpired: handleSessionExpired,
    updateProfileBalance: () => {
      updateBalance();
      updateProfileStats();
    },
    updateProfileStats,
    updateBalance,
    refreshRankBadge,
    showProfile,
    onAuthStateChanged: null,
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Update profile balance periodically (only when viewing own profile)
  setInterval(() => {
    if (currentUser && window.Game) {
      updateBalance();
      if (isViewingOwnProfile()) updateProfileStats();
    }
  }, 1000);
})();

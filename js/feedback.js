/**
 * Feedback system: FAB button, slide-up panel, admin management view.
 */
(function () {
  'use strict';

  var API = '/api';

  var STATUS_LABELS = {
    pending: 'Pending',
    accepted: 'Accepted',
    working: 'Working On It',
    done_waiting: 'Done \u2013 Waiting for Update',
    finished: 'Finished \u2013 Implemented',
    denied: 'Denied',
  };

  var STATUS_NEXT = {
    accepted: 'working',
    working: 'done_waiting',
    done_waiting: 'finished',
  };

  var STATUS_NEXT_LABEL = {
    working: 'Mark as Done \u2013 Waiting',
    done_waiting: 'Mark as Finished',
  };

  function getWorkingLabel() {
    return 'Developing\u2026';
  }

  function getWorkingAdvanceLabel() {
    return 'Mark as Developing';
  }

  function getStatusLabel(status) {
    if (status === 'working') return getWorkingLabel();
    return STATUS_LABELS[status] || status;
  }

  var TYPE_LABELS = {
    idea: 'Idea',
    bug: 'Bug',
    feedback: 'Feedback',
    error: 'Error',
    cheat: 'Cheat/Abuse',
  };

  var fab = null;
  var panel = null;
  var panelClose = null;

  var currentTab = 'new';
  var imageDataUrl = null;
  var adminFeedbacks = [];
  var adminTab = 'pending';
  var adminNavInjected = false;

  function getAuthHeaders() {
    return window.Auth && window.Auth.getAuthHeaders ? window.Auth.getAuthHeaders() : {};
  }

  function isAdminOrOwner() {
    var u = window.Auth && window.Auth.user;
    if (!u) return false;
    return u.isOwner || u.isAdmin || u.role === 'owner' || u.role === 'admin';
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s != null ? String(s) : '';
    return d.innerHTML;
  }

  function timeAgo(ts) {
    var diff = Date.now() - ts;
    var s = Math.floor(diff / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    var w = Math.floor(d / 7);
    if (w < 5) return w + 'w ago';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(d / 365) + 'y ago';
  }

  // ---- Panel open / close ----

  function applyUsernameField() {
    var usernameInput = document.getElementById('fbUsername');
    if (!usernameInput) return;
    if (window.Auth && window.Auth.user) {
      var u = window.Auth.user;
      usernameInput.value = u.displayName || u.username || '';
      usernameInput.readOnly = true;
      usernameInput.classList.add('fb-input--readonly');
    }
  }

  function openPanel() {
    if (!panel) return;
    panel.classList.remove('feedback-panel--closed');
    if (fab) fab.classList.add('feedback-fab--open');
    applyUsernameField();
    // Refresh whichever data tab is active
    if (currentTab === 'mine') loadMyFeedbacks();
    if (currentTab === 'all') loadAllFeedbacks();
  }

  function closePanel() {
    if (!panel) return;
    panel.classList.add('feedback-panel--closed');
    if (fab) fab.classList.remove('feedback-fab--open');
  }

  function isPanelOpen() {
    return panel && !panel.classList.contains('feedback-panel--closed');
  }

  // ---- Tabs ----

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.feedback-tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('#feedbackPanel .feedback-tab-content').forEach(function (c) {
      c.classList.toggle('hidden', c.dataset.tab !== tab);
    });
    if (tab === 'mine') loadMyFeedbacks();
    if (tab === 'all') loadAllFeedbacks();
  }

  // ---- Image upload ----

  function initImageUpload() {
    var zone = document.getElementById('fbImageZone');
    var input = document.getElementById('fbImageInput');
    var removeBtn = document.getElementById('fbImageRemove');
    if (!zone || !input) return;

    zone.addEventListener('click', function (e) {
      if (e.target === removeBtn || removeBtn && removeBtn.contains(e.target)) return;
      input.click();
    });

    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });

    input.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) handleImageFile(file);
      input.value = '';
    });

    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('fb-image-zone--drag');
    });

    zone.addEventListener('dragleave', function () {
      zone.classList.remove('fb-image-zone--drag');
    });

    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('fb-image-zone--drag');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) handleImageFile(file);
    });

    document.addEventListener('paste', function (e) {
      if (!isPanelOpen() || currentTab !== 'new') return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          var file = items[i].getAsFile();
          if (file) { handleImageFile(file); break; }
        }
      }
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        clearImage();
      });
    }
  }

  function handleImageFile(file) {
    if (file.size > 2 * 1024 * 1024) {
      showFormError('Image too large (max 2MB)');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      imageDataUrl = e.target.result;
      showImagePreview(imageDataUrl);
    };
    reader.readAsDataURL(file);
  }

  function showImagePreview(dataUrl) {
    var preview = document.getElementById('fbImagePreview');
    var removeBtn = document.getElementById('fbImageRemove');
    var hint = document.querySelector('#fbImageZone .fb-image-zone-hint');
    if (preview) { preview.src = dataUrl; preview.classList.remove('hidden'); }
    if (removeBtn) removeBtn.classList.remove('hidden');
    if (hint) hint.classList.add('hidden');
  }

  function clearImage() {
    imageDataUrl = null;
    var preview = document.getElementById('fbImagePreview');
    var removeBtn = document.getElementById('fbImageRemove');
    var hint = document.querySelector('#fbImageZone .fb-image-zone-hint');
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    if (removeBtn) removeBtn.classList.add('hidden');
    if (hint) hint.classList.remove('hidden');
  }

  // ---- New Feedback form ----

  function showFormError(msg) {
    var el = document.getElementById('fbError');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }

  function hideFormError() {
    var el = document.getElementById('fbError');
    if (el) el.classList.add('hidden');
  }

  async function submitFeedback(e) {
    e.preventDefault();
    hideFormError();

    var username = (document.getElementById('fbUsername') && document.getElementById('fbUsername').value || '').trim();
    var discordName = (document.getElementById('fbDiscord') && document.getElementById('fbDiscord').value || '').trim();
    var title = (document.getElementById('fbTitle') && document.getElementById('fbTitle').value || '').trim();
    var type = document.getElementById('fbType') && document.getElementById('fbType').value || '';
    var description = (document.getElementById('fbDescription') && document.getElementById('fbDescription').value || '').trim();

    if (!title) { showFormError('Title is required'); return; }
    if (!type) { showFormError('Please select a type'); return; }
    if (!description) { showFormError('Description is required'); return; }

    var submitBtn = document.querySelector('#feedbackForm .btn-fb-submit');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var res = await fetch(API + '/feedback', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ username: username, discordName: discordName, title: title, type: type, description: description, referenceImage: imageDataUrl }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok) {
        var form = document.getElementById('feedbackForm');
        var success = document.getElementById('fbSuccess');
        if (form) form.classList.add('hidden');
        if (success) success.classList.remove('hidden');
      } else {
        showFormError(data.error || 'Submit failed');
      }
    } catch (err) {
      showFormError('Network error, please try again');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // ---- My Feedbacks ----

  async function loadMyFeedbacks() {
    var el = document.getElementById('fbMyList');
    if (!el) return;
    if (!window.Auth || !window.Auth.isAuthenticated || !window.Auth.isAuthenticated()) {
      el.innerHTML = '<div class="fb-empty">Log in to see your feedbacks</div>';
      return;
    }
    el.innerHTML = '<div class="fb-loading">Loading\u2026</div>';
    try {
      var res = await fetch(API + '/feedback/my', { headers: getAuthHeaders() });
      var data = await res.json().catch(function () { return {}; });
      var list = data.feedbacks || [];
      if (!list.length) {
        el.innerHTML = '<div class="fb-empty">No feedbacks submitted yet</div>';
        return;
      }
      el.innerHTML = list.map(function (f) {
        var statusLabel = getStatusLabel(f.status);
        return '<div class="fb-item">' +
          '<div class="fb-item-head">' +
            '<span class="fb-item-title">' + esc(f.title) + '</span>' +
            '<span class="fb-status-badge fb-status-' + esc(f.status) + '">' + esc(statusLabel) + '</span>' +
          '</div>' +
          '<div class="fb-item-time">' + timeAgo(f.createdAt) + '</div>' +
        '</div>';
      }).join('');
    } catch (err) {
      el.innerHTML = '<div class="fb-empty">Failed to load</div>';
    }
  }

  // ---- All Feedbacks (public) ----

  async function loadAllFeedbacks() {
    var el = document.getElementById('fbAllList');
    if (!el) return;
    el.innerHTML = '<div class="fb-loading">Loading\u2026</div>';
    try {
      var res = await fetch(API + '/feedback/public');
      var data = await res.json().catch(function () { return {}; });
      var list = data.feedbacks || [];
      if (!list.length) {
        el.innerHTML = '<div class="fb-empty">No feedbacks yet</div>';
        return;
      }
      el.innerHTML = list.map(function (f) {
        var statusLabel = getStatusLabel(f.status);
        return '<div class="fb-item">' +
          '<div class="fb-item-head">' +
            '<span class="fb-item-user">' + esc(f.username || 'Anonymous') + '</span>' +
            '<span class="fb-status-badge fb-status-' + esc(f.status) + '">' + esc(statusLabel) + '</span>' +
          '</div>' +
          '<div class="fb-item-title">' + esc(f.title) + '</div>' +
          '<div class="fb-item-desc">' + esc(f.description) + '</div>' +
          '<div class="fb-item-time">' + timeAgo(f.createdAt) + '</div>' +
        '</div>';
      }).join('');
    } catch (err) {
      el.innerHTML = '<div class="fb-empty">Failed to load</div>';
    }
  }

  // ---- Admin feedback integration ----

  function injectAdminNav() {
    if (adminNavInjected) return;
    var adminHead = document.querySelector('.admin-modal-head');
    if (!adminHead) return;
    var nav = document.getElementById('adminModalNav');
    if (!nav) return;
    // Show nav only for admin/owner (not mods)
    if (!isAdminOrOwner()) return;
    nav.classList.remove('hidden');
    adminNavInjected = true;

    document.getElementById('adminNavUsers').addEventListener('click', function () {
      switchAdminView('users');
    });
    document.getElementById('adminNavFeedback').addEventListener('click', function () {
      switchAdminView('feedback');
      loadAdminFeedbacks();
    });

    // Bind tab buttons in feedback panel
    document.querySelectorAll('.admin-fb-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        adminTab = btn.dataset.tab;
        document.querySelectorAll('.admin-fb-tab-btn').forEach(function (b) {
          b.classList.toggle('active', b.dataset.tab === adminTab);
        });
        renderAdminFeedbacks();
      });
    });
  }

  function switchAdminView(view) {
    var panelList = document.getElementById('adminPanelList');
    var userDetail = document.getElementById('adminUserDetail');
    var feedbackPanel = document.getElementById('adminFeedbackPanel');
    var usersBtn = document.getElementById('adminNavUsers');
    var feedbackBtn = document.getElementById('adminNavFeedback');

    if (view === 'feedback') {
      if (panelList) panelList.classList.add('hidden');
      if (userDetail) userDetail.classList.add('hidden');
      if (feedbackPanel) feedbackPanel.classList.remove('hidden');
      if (usersBtn) usersBtn.classList.remove('active');
      if (feedbackBtn) feedbackBtn.classList.add('active');
    } else {
      if (panelList) panelList.classList.remove('hidden');
      if (userDetail) {
        // Keep detail hidden; only show list
        // (the admin JS manages detail vs list — we just ensure list is visible)
      }
      if (feedbackPanel) feedbackPanel.classList.add('hidden');
      if (usersBtn) usersBtn.classList.add('active');
      if (feedbackBtn) feedbackBtn.classList.remove('active');
    }
  }

  async function loadAdminFeedbacks() {
    var container = document.getElementById('adminFbCards');
    if (!container) return;
    container.innerHTML = '<div class="fb-loading">Loading\u2026</div>';
    try {
      var res = await fetch(API + '/admin/feedback', { headers: getAuthHeaders() });
      if (!res.ok) { container.innerHTML = '<div class="fb-empty">Access denied</div>'; return; }
      var data = await res.json().catch(function () { return {}; });
      adminFeedbacks = data.feedbacks || [];
      renderAdminFeedbacks();
    } catch (err) {
      container.innerHTML = '<div class="fb-empty">Failed to load</div>';
    }
  }

  function renderAdminFeedbacks() {
    var container = document.getElementById('adminFbCards');
    if (!container) return;

    var filtered;
    if (adminTab === 'pending') {
      filtered = adminFeedbacks.filter(function (f) { return f.status === 'pending'; });
    } else if (adminTab === 'active') {
      filtered = adminFeedbacks.filter(function (f) { return f.status === 'accepted' || f.status === 'working' || f.status === 'done_waiting'; });
    } else if (adminTab === 'done') {
      filtered = adminFeedbacks.filter(function (f) { return f.status === 'finished'; });
    } else {
      filtered = adminFeedbacks.filter(function (f) { return f.status === 'denied'; });
    }

    if (!filtered.length) {
      container.innerHTML = '<div class="fb-empty">Nothing here</div>';
      return;
    }

    container.innerHTML = filtered.map(function (f) {
      var typeLabel = TYPE_LABELS[f.type] || f.type;
      var statusLabel = getStatusLabel(f.status);
      var ago = timeAgo(f.createdAt);
      var nextStatus = STATUS_NEXT[f.status];
      var nextLabel = f.status === 'accepted' ? getWorkingAdvanceLabel() : (STATUS_NEXT_LABEL[f.status] || '');

      var imgHtml = f.referenceImage
        ? '<img src="' + esc(f.referenceImage) + '" class="admin-fb-ref-img" alt="Reference" />'
        : '';

      var discordHtml = f.discordName
        ? '<div class="admin-fb-discord">Discord: ' + esc(f.discordName) + '</div>'
        : '';

      var actions = '';
      if (f.status === 'pending') {
        actions =
          '<button class="btn-admin-fb-accept" data-id="' + esc(f.id) + '" data-action="accept">Accept</button>' +
          '<button class="btn-admin-fb-deny" data-id="' + esc(f.id) + '" data-action="deny">Deny</button>';
      } else if (nextStatus) {
        actions = '<button class="btn-admin-fb-advance" data-id="' + esc(f.id) + '" data-status="' + esc(nextStatus) + '">' + esc(nextLabel) + '</button>';
      }

      return '<div class="admin-fb-card" data-id="' + esc(f.id) + '">' +
        '<div class="admin-fb-card-head">' +
          '<span class="admin-fb-type fb-type-' + esc(f.type) + '">' + esc(typeLabel) + '</span>' +
          '<span class="fb-status-badge fb-status-' + esc(f.status) + '">' + esc(statusLabel) + '</span>' +
          '<span class="admin-fb-time">' + ago + '</span>' +
        '</div>' +
        '<div class="admin-fb-username">' + esc(f.username || 'Anonymous') + '</div>' +
        '<div class="admin-fb-title">' + esc(f.title) + '</div>' +
        '<div class="admin-fb-desc">' + esc(f.description) + '</div>' +
        imgHtml +
        discordHtml +
        '<div class="admin-fb-actions">' + actions + '</div>' +
      '</div>';
    }).join('');

    // Bind accept/deny
    container.querySelectorAll('[data-action="accept"]').forEach(function (btn) {
      btn.addEventListener('click', function () { updateFeedbackStatus(btn.dataset.id, 'accepted'); });
    });
    container.querySelectorAll('[data-action="deny"]').forEach(function (btn) {
      btn.addEventListener('click', function () { updateFeedbackStatus(btn.dataset.id, 'denied'); });
    });
    // Bind advance
    container.querySelectorAll('[data-status]').forEach(function (btn) {
      btn.addEventListener('click', function () { updateFeedbackStatus(btn.dataset.id, btn.dataset.status); });
    });
  }

  async function updateFeedbackStatus(id, status) {
    try {
      var res = await fetch(API + '/admin/feedback/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ status: status }),
      });
      if (res.ok) {
        var f = adminFeedbacks.find(function (x) { return x.id === id; });
        if (f) { f.status = status; f.updatedAt = Date.now(); }
        renderAdminFeedbacks();
      }
    } catch (err) {
      console.warn('Failed to update feedback status:', err.message);
    }
  }

  // ---- Admin modal watcher ----

  function watchAdminModal() {
    var adminModal = document.getElementById('adminModal');
    if (!adminModal) return;
    var observer = new MutationObserver(function () {
      if (!adminModal.classList.contains('hidden')) {
        injectAdminNav();
      }
    });
    observer.observe(adminModal, { attributes: true, attributeFilter: ['class'] });
    // In case modal is already open
    if (!adminModal.classList.contains('hidden')) injectAdminNav();
  }

  // ---- Init ----

  function init() {
    fab = document.getElementById('feedbackFab');
    panel = document.getElementById('feedbackPanel');
    panelClose = document.getElementById('feedbackPanelClose');
    if (!fab || !panel) return;

    fab.addEventListener('click', function () {
      if (isPanelOpen()) {
        closePanel();
      } else {
        openPanel();
      }
    });

    if (panelClose) panelClose.addEventListener('click', closePanel);

    // Tab buttons
    document.querySelectorAll('.feedback-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    // Form submit
    var form = document.getElementById('feedbackForm');
    if (form) form.addEventListener('submit', submitFeedback);

    // "Submit another" button after success
    var successNew = document.getElementById('fbSuccessNew');
    if (successNew) {
      successNew.addEventListener('click', function () {
        var f = document.getElementById('feedbackForm');
        var s = document.getElementById('fbSuccess');
        if (f) { f.reset(); f.classList.remove('hidden'); }
        if (s) s.classList.add('hidden');
        clearImage();
        hideFormError();
        applyUsernameField();
      });
    }

    initImageUpload();
    watchAdminModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Feedback = { openPanel: openPanel, closePanel: closePanel };
})();

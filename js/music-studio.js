/**
 * AI Music Studio – Suno via provider API
 * Tabs: Create | My Songs | All Songs
 * Handles: form submission, generate-video toggle, polling,
 *          publish, synced lyrics, inline video player
 */
(function () {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  function getToken() { return localStorage.getItem('gambleio_token') || ''; }
  function getUser()    { try { return window.Auth?.getCurrentUser?.() || null; } catch { return null; } }
  function isLoggedIn() { return !!getUser(); }
  function isOwner()    { try { const u = getUser(); return !!(u && (u.role === 'owner' || u.isOwner)); } catch { return false; } }
  function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const overlay          = $('studioOverlay');
  const closeBtn         = $('studioClose');
  const tabs             = document.querySelectorAll('.studio-tab');
  const panels           = { create: $('studioCreate'), my: $('studioMySongs'), all: $('studioAllSongs') };

  const form             = $('studioForm');
  const modeSimple       = $('studioModeSimple');
  const modeAdvanced     = $('studioModeAdvanced');
  const fldTitle         = $('studioTitle');
  const fldStyle         = $('studioStyle');
  const fldPrompt        = $('studioPrompt');
  const fldInstrumental  = $('studioInstrumental');
  const fldModel         = $('studioModel');
  const fldWantsVideo    = $('studioWantsVideo');
  const promptLabel      = $('studioPromptLabel');
  const generateBtn      = $('studioGenerateBtn');
  const formStatus       = $('studioFormStatus');
  const advFields        = document.querySelectorAll('.studio-adv');
  const instrumentalWrap = $('studioInstrumentalWrap');

  const trialBanner      = $('studioTrialBanner');
  const trialText        = $('studioTrialText');
  const TRIAL_LIMIT      = 2;

  const loginPrompt      = $('studioLoginPrompt');
  const myEmpty          = $('studioMyEmpty');
  const myList           = $('studioMyTrackList');
  const allEmpty         = $('studioAllEmpty');
  const allList          = $('studioAllTrackList');

  const lyricsPanel      = $('studioLyricsPanel');
  const lyricsTitle      = $('studioLyricsTrackName');
  const lyricsBody       = $('studioLyricsBody');
  const lyricsClose      = $('studioLyricsClose');

  // ── State ─────────────────────────────────────────────────────────────────
  let activeTab        = 'create';
  let isAdvanced       = false;
  let mySongs          = [];
  let allSongs         = [];
  let pollTimer        = null;
  let lyricsOpen       = false;
  let parsedLyrics     = null;    // [{t, text}] or null
  let currentPlayingId = null;    // id of AI track in player

  // ── Lyrics parser ─────────────────────────────────────────────────────────
  function parseLyrics(raw) {
    if (!raw || typeof raw !== 'string') return null;
    if (raw.trim().startsWith('[{')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr[0]?.t !== undefined) return arr;
      } catch {}
    }
    const lines = [];
    const re = /\[(\d+):(\d{2})(?:\.(\d+))?\]([^\[]*)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const t = parseInt(m[1]) * 60 + parseInt(m[2]) + (m[3] ? parseInt(m[3].padEnd(3,'0').slice(0,3)) / 1000 : 0);
      const text = m[4].trim();
      if (text) lines.push({ t, text });
    }
    return lines.length ? lines.sort((a, b) => a.t - b.t) : null;
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  function openStudio() {
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    enforceOwnerUI();
    // Non-owners land on All Songs; owners land on Create
    switchTab(isOwner() ? activeTab || 'create' : 'all-songs');
    loadLibrary();
    startPolling();
  }
  function closeStudio() {
    if (!overlay) return;
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    stopPolling();
  }

  window.addEventListener('music-studio:open', openStudio);
  closeBtn?.addEventListener('click', closeStudio);
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeStudio(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStudio(); });

  // ── Owner-gated UI enforcement ────────────────────────────────────────────
  // Called on init and every auth-changed event.
  function enforceOwnerUI() {
    const owner = isOwner();

    // Studio button: only visible to owner
    const btnStudio = $('mpStudio');
    if (btnStudio) btnStudio.classList.toggle('hidden', !owner);

    // Create and My Songs tabs: owner-only
    tabs.forEach(b => {
      if (b.dataset.tab === 'create' || b.dataset.tab === 'my-songs') {
        b.classList.toggle('hidden', !owner);
      }
    });

    // If studio is open and current tab is owner-only but user is no longer owner, redirect to All Songs
    if (!owner && (activeTab === 'create' || activeTab === 'my-songs')) {
      switchTab('all-songs');
    }
    updateTrialBanner();
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function switchTab(tab) {
    // Block non-owners from reaching restricted tabs
    if ((tab === 'create' || tab === 'my-songs') && !isOwner()) tab = 'all-songs';

    activeTab = tab;
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    panels.create.classList.toggle('hidden', tab !== 'create');
    panels.my.classList.toggle('hidden',     tab !== 'my-songs');
    panels.all.classList.toggle('hidden',    tab !== 'all-songs');
    if (tab === 'my-songs' || tab === 'all-songs') loadLibrary();
  }
  tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // ── Mode (Simple / Advanced) ──────────────────────────────────────────────
  function setMode(adv) {
    isAdvanced = adv;
    modeSimple?.classList.toggle('active', !adv);
    modeAdvanced?.classList.toggle('active', adv);
    advFields.forEach(el => el.classList.toggle('hidden', !adv));
    refreshPromptLabel();
  }
  function refreshPromptLabel() {
    if (!promptLabel) return;
    const isLyrics = isAdvanced && !fldInstrumental?.checked;
    promptLabel.childNodes[0].textContent = isLyrics ? 'Lyrics ' : 'Describe your track ';
  }
  modeSimple?.addEventListener('click',   () => setMode(false));
  modeAdvanced?.addEventListener('click', () => setMode(true));
  fldInstrumental?.addEventListener('change', refreshPromptLabel);

  // ── Status helpers ────────────────────────────────────────────────────────
  function setStatus(msg, type) {
    if (!formStatus) return;
    formStatus.textContent = msg;
    formStatus.className = 'studio-status ' + (type || '');
  }

  // ── Generate form ─────────────────────────────────────────────────────────
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isLoggedIn()) { setStatus('Sign in to generate music.', 'err'); return; }

    generateBtn.disabled = true;
    setStatus('Submitting…', 'ok');

    const wantsVideo = !!fldWantsVideo?.checked;
    const body = {
      customMode:   isAdvanced,
      instrumental: isAdvanced ? !!fldInstrumental?.checked : false,
      model:        fldModel?.value || 'V4_5',
      prompt:       fldPrompt?.value?.trim() || '',
      title:        isAdvanced ? (fldTitle?.value?.trim() || '') : '',
      style:        isAdvanced ? (fldStyle?.value?.trim() || '') : '',
      wantsVideo,
    };

    try {
      const res  = await fetch('/api/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      const statusMsg = wantsVideo
        ? 'Track submitted! Generating audio + video — this takes several minutes.'
        : 'Track submitted! Generating… this takes a few minutes.';
      setStatus(statusMsg, 'ok');
      form.reset();
      setMode(false);

      // Optimistically prepend PENDING card
      mySongs.unshift(data.track);
      renderMySongs();
      switchTab('my-songs');
      startPolling();
    } catch (err) {
      setStatus(err.message, 'err');
    } finally {
      generateBtn.disabled = false;
    }
  });

  // ── Trial credits banner ──────────────────────────────────────────────────
  function updateTrialBanner() {
    if (!trialBanner || !trialText) return;
    if (!isOwner()) { trialBanner.classList.add('hidden'); return; }

    const used = mySongs.length;
    const left = Math.max(0, TRIAL_LIMIT - used);
    trialBanner.classList.remove('hidden', 'exhausted');

    if (left === 0) {
      trialBanner.classList.add('exhausted');
      trialText.innerHTML = `You have used all <strong>${TRIAL_LIMIT}</strong> trial songs — <strong>0 songs left</strong>`;
    } else {
      trialText.innerHTML = `You have ${TRIAL_LIMIT} free trial songs — <strong>${left} song${left !== 1 ? 's' : ''} left</strong>`;
    }
  }

  // ── Library fetch ─────────────────────────────────────────────────────────
  async function loadLibrary() {
    try {
      const res  = await fetch('/api/music/library', {
        headers: getToken() ? { Authorization: 'Bearer ' + getToken() } : {},
      });
      const data = await res.json();
      mySongs  = data.mySongs  || [];
      allSongs = data.allSongs || [];
      renderMySongs();
      renderAllSongs();
      updateTrialBanner();
    } catch {}
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      const hasPending = mySongs.some(t => t.status === 'PENDING');
      if (!hasPending) { stopPolling(); return; }
      await loadLibrary();
    }, 12000);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderMySongs() {
    if (!myList) return;
    if (!isLoggedIn()) {
      loginPrompt?.classList.remove('hidden');
      myEmpty?.classList.add('hidden');
      myList.innerHTML = '';
      return;
    }
    loginPrompt?.classList.add('hidden');
    if (!mySongs.length) { myEmpty?.classList.remove('hidden'); myList.innerHTML = ''; return; }
    myEmpty?.classList.add('hidden');
    myList.innerHTML = '';
    mySongs.forEach(t => myList.appendChild(buildTrackCard(t, true)));
  }

  function renderAllSongs() {
    if (!allList) return;
    if (!allSongs.length) { allEmpty?.classList.remove('hidden'); allList.innerHTML = ''; return; }
    allEmpty?.classList.add('hidden');
    allList.innerHTML = '';
    allSongs.forEach(t => allList.appendChild(buildTrackCard(t, false)));
  }

  // ── Build track card ───────────────────────────────────────────────────────
  function buildTrackCard(track, isMine) {
    const isPlaying = track.id === currentPlayingId;
    const card = document.createElement('div');
    card.className = 'studio-track-card' + (isPlaying ? ' playing' : '');
    card.dataset.id = track.id;

    // Cover art
    const artHTML = track.imageUrl
      ? `<div class="studio-track-art"><img src="${esc(track.imageUrl)}" alt=""></div>`
      : `<div class="studio-track-art"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg></div>`;

    // Sub-label
    const subText = track.style
      ? esc(track.style.slice(0, 60))
      : (track.status === 'PENDING'
          ? (track.wantsVideo ? 'Generating audio + video…' : 'Generating…')
          : (isMine ? 'By you' : `By ${esc(track.userId)}`));

    // Badges
    let badges = '';
    if (track.status === 'PENDING') {
      const label = track.wantsVideo ? 'Generating…' : 'Generating';
      badges = `<span class="studio-badge studio-badge-pending"><span class="studio-spinner"></span> ${label}</span>`;
    } else if (track.status === 'FAILED') {
      badges = `<span class="studio-badge studio-badge-failed">Failed</span>`;
    } else if (track.videoUrl) {
      badges = `<span class="studio-badge studio-badge-video">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
        Video
      </span>`;
    }

    // Action buttons
    let actions = '';
    if (track.status === 'COMPLETE' && track.audioUrl) {
      actions += `<button class="studio-act-btn play-btn${isPlaying ? ' playing-btn' : ''}" data-action="play" title="${isPlaying ? 'Now playing' : 'Play'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="${isPlaying ? 'M6 19h4V5H6zm8-14v14h4V5z' : 'M8 5v14l11-7z'}"/></svg>
        ${isPlaying ? 'Playing' : 'Play'}
      </button>`;
      if (track.lyrics) {
        actions += `<button class="studio-act-btn lyrics-btn" data-action="lyrics" title="Show lyrics">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM13 3.5 18.5 9H13V3.5zM8 17h8v1H8v-1zm0-3h8v1H8v-1zm0-3h5v1H8v-1z"/></svg>
          Lyrics
        </button>`;
      }
      if (track.videoUrl) {
        actions += `<button class="studio-act-btn lyrics-btn" data-action="video" title="Watch video">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
          Video
        </button>`;
      }
      if (isMine && !track.isPublished) {
        actions += `<button class="studio-act-btn publish-btn" data-action="publish" title="Publish to All Songs">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4.5 20.3l.7.7L12 17l6.8 4 .7-.7L12 2z"/></svg>
          Publish
        </button>`;
      } else if (isMine && track.isPublished) {
        actions += `<span class="studio-badge studio-badge-done">Published</span>`;
      }
    }

    card.innerHTML = `
      <div class="studio-track-top">
        ${artHTML}
        <div class="studio-track-meta">
          <div class="studio-track-name">${esc(track.title || 'Untitled')}</div>
          <div class="studio-track-sub">${subText}</div>
        </div>
        ${badges}
        <div class="studio-track-actions">${actions}</div>
      </div>`;

    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'play')    handlePlay(track, card);
      if (action === 'lyrics')  handleShowPanel(track, 'lyrics');
      if (action === 'video')   handleShowPanel(track, 'video');
      if (action === 'publish') handlePublish(track, btn);
    });

    return card;
  }

  // ── Play ──────────────────────────────────────────────────────────────────
  function handlePlay(track, card) {
    if (track.id === currentPlayingId) return;
    currentPlayingId = track.id;

    const mp = window.MusicPlayer;
    if (mp) {
      mp.loadAiTrack(track);
      const lines = parseLyrics(track.lyrics);
      mp.setActiveLyrics(lines);
      parsedLyrics = lines;
      // Refresh lyrics/video panel if open
      if (lyricsOpen) showLyricsPanel(track, currentPanelMode);
    }

    document.querySelectorAll('.studio-track-card').forEach(c => c.classList.remove('playing'));
    card.classList.add('playing');
    renderMySongs();
    renderAllSongs();
  }

  // ── Lyrics / Video panel ──────────────────────────────────────────────────
  let currentPanelMode = 'lyrics'; // 'lyrics' | 'video'

  function handleShowPanel(track, mode) {
    currentPanelMode = mode;
    parsedLyrics = parseLyrics(track.lyrics);
    lyricsOpen = true;
    showLyricsPanel(track, mode);
  }

  function showLyricsPanel(track, mode) {
    if (!lyricsPanel) return;
    lyricsPanel.classList.remove('hidden');
    if (lyricsTitle) {
      lyricsTitle.textContent = (mode === 'video' ? '▶ Video — ' : '♪ Lyrics — ') + (track.title || 'Track');
    }
    if (!lyricsBody) return;
    lyricsBody.innerHTML = '';

    if (mode === 'video' && track.videoUrl) {
      // Inline looping video — audio plays through the main player
      const vid = document.createElement('video');
      vid.className = 'studio-video-player';
      vid.src = track.videoUrl;
      vid.loop = true;
      vid.muted = true;        // muted so it doesn't double-play audio
      vid.autoplay = true;
      vid.playsInline = true;
      vid.controls = false;
      lyricsBody.appendChild(vid);

      // Sync video position with the main audio element
      const mp = window.MusicPlayer;
      if (mp) {
        const audio = mp.getAudio();
        if (audio) {
          vid.currentTime = audio.currentTime;
          audio.addEventListener('play',   () => vid.play().catch(() => {}));
          audio.addEventListener('pause',  () => vid.pause());
          audio.addEventListener('seeked', () => { vid.currentTime = audio.currentTime; });
        }
      }
    } else if (track.lyrics) {
      // Synced or plain lyrics
      if (parsedLyrics) {
        lyricsBody.innerHTML = parsedLyrics
          .map((l, i) => `<div class="studio-lyric-line" data-idx="${i}">${esc(l.text)}</div>`)
          .join('');
      } else {
        lyricsBody.innerHTML = `<div class="studio-plain-lyrics">${esc(track.lyrics)}</div>`;
      }
    } else {
      lyricsBody.innerHTML = `<div class="studio-plain-lyrics" style="color:var(--text-muted)">No lyrics available.</div>`;
    }
  }

  function hideLyricsPanel() {
    lyricsOpen = false;
    lyricsPanel?.classList.add('hidden');
    if (lyricsBody) lyricsBody.innerHTML = '';
    if (window.MusicPlayer) window.MusicPlayer.setActiveLyrics(null);
    parsedLyrics = null;
  }

  lyricsClose?.addEventListener('click', hideLyricsPanel);

  // ── Synced lyrics: timeupdate ─────────────────────────────────────────────
  function syncLyrics() {
    if (!lyricsOpen || !parsedLyrics || !lyricsBody || currentPanelMode !== 'lyrics') return;
    const mp = window.MusicPlayer;
    if (!mp) return;
    const idx   = mp.getCurrentLyricIndex();
    const lines = lyricsBody.querySelectorAll('.studio-lyric-line');
    lines.forEach((el, i) => {
      const active = i === idx;
      el.classList.toggle('active', active);
      if (active) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function attachAudioListeners() {
    const mp = window.MusicPlayer;
    if (!mp) return;
    const audio = mp.getAudio();
    if (audio) audio.addEventListener('timeupdate', syncLyrics);
  }

  // ── Publish ───────────────────────────────────────────────────────────────
  async function handlePublish(track, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    try {
      const res  = await fetch('/api/music/publish/' + track.id, {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      track.isPublished = true;
      await loadLibrary();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Publish';
      alert('Failed to publish: ' + err.message);
    }
  }

  // ── Auth change ───────────────────────────────────────────────────────────
  window.addEventListener('auth-changed', () => { enforceOwnerUI(); loadLibrary(); });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    attachAudioListeners();
    enforceOwnerUI();
    if (overlay && !overlay.classList.contains('hidden')) loadLibrary();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

})();

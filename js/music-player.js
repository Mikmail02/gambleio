/**
 * Global Music Player – playback, favorites, drag-to-move, admin panel
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let tracks = [];
  let currentIndex = -1;
  let playing = false;
  let playlist = 'all';
  let favorites = [];
  const audio = new Audio();
  audio.volume = 0.5;
  audio.preload = 'auto';
  let userInteracted = false;

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const player         = $('musicPlayer');
  const btnPlay        = $('mpPlay');
  const btnPrev        = $('mpPrev');
  const btnNext        = $('mpNext');
  const btnFav         = $('mpFav');
  const elTitle        = $('mpTrackTitle');
  const volumeSlider   = $('mpVolume');
  const playlistToggle    = $('mpPlaylistToggle');
  const playlistDropdown  = $('mpPlaylistDropdown');
  const iconPlay  = btnPlay?.querySelector('.mp-icon-play');
  const iconPause = btnPlay?.querySelector('.mp-icon-pause');

  // Seek bar refs
  const seekBar      = $('mpSeekBar');
  const seekFill     = $('mpSeekFill');
  const seekThumb    = $('mpSeekThumb');
  const elTimeCur    = $('mpTimeCurrent');
  const elTimeDur    = $('mpTimeDuration');

  // Admin refs
  const adminNavMusic          = $('adminNavMusic');
  const adminMusicPanel        = $('adminMusicPanel');
  const adminMusicFile         = $('adminMusicFile');
  const adminMusicFileName     = $('adminMusicFileName');
  const adminMusicUploadBtn    = $('adminMusicUploadBtn');
  const adminMusicUploadStatus = $('adminMusicUploadStatus');
  const adminMusicList         = $('adminMusicList');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getToken() { return localStorage.getItem('gambleio_token') || ''; }
  function getUserKey() {
    try { return window.Auth?.getCurrentUser?.()?.username || 'anon'; }
    catch { return 'anon'; }
  }
  function loadFavorites() {
    try { favorites = JSON.parse(localStorage.getItem('music_favs_' + getUserKey()) || '[]'); }
    catch { favorites = []; }
  }
  function saveFavorites() {
    localStorage.setItem('music_favs_' + getUserKey(), JSON.stringify(favorites));
  }
  function getActiveList() {
    return playlist === 'favorites' ? tracks.filter(t => favorites.includes(t.filename)) : tracks;
  }

  // ── Drag-to-move ───────────────────────────────────────────────────────────
  const POS_KEY = 'music_player_pos';

  function getDefaultPosition() {
    // Center between nav (end) and header-right (start)
    const nav = document.querySelector('.nav');
    const hr  = document.querySelector('.header-right');
    const header = document.querySelector('.header');
    if (!player) return { x: 0, y: 0 };

    const pw = player.offsetWidth || 300;
    const ph = player.offsetHeight || 36;

    if (nav && hr && header) {
      const navRect = nav.getBoundingClientRect();
      const hrRect  = hr.getBoundingClientRect();
      const gapLeft  = navRect.right;
      const gapRight = hrRect.left;
      const cx = (gapLeft + gapRight) / 2 - pw / 2;
      const cy = header.getBoundingClientRect().top + (header.offsetHeight - ph) / 2;
      return { x: Math.round(cx), y: Math.round(Math.max(0, cy)) };
    }
    // Fallback: center of viewport top
    return { x: Math.round((window.innerWidth - pw) / 2), y: 16 };
  }

  function clampPosition(x, y) {
    if (!player) return { x, y };
    const pw = player.offsetWidth || 300;
    const ph = player.offsetHeight || 36;
    const maxX = window.innerWidth - pw;
    const maxY = window.innerHeight - ph;
    return {
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    };
  }

  function applyPosition(x, y) {
    if (!player) return;
    const pos = clampPosition(x, y);
    player.style.left = pos.x + 'px';
    player.style.top  = pos.y + 'px';
  }

  function savePosition() {
    if (!player) return;
    localStorage.setItem(POS_KEY, JSON.stringify({
      x: parseInt(player.style.left) || 0,
      y: parseInt(player.style.top) || 0,
    }));
  }

  function restorePosition() {
    if (!player) return;
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY));
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        applyPosition(saved.x, saved.y);
        return;
      }
    } catch {}
    const def = getDefaultPosition();
    applyPosition(def.x, def.y);
  }

  // Drag handlers — entire player surface is draggable unless clicking interactive elements
  if (player) {
    let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0;
    const INTERACTIVE = 'button, input, .mp-seek-bar, a';

    player.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Don't drag when clicking buttons, inputs, or the seek bar
      if (e.target.closest(INTERACTIVE)) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = parseInt(player.style.left) || 0;
      origY = parseInt(player.style.top) || 0;
      player.classList.add('mp-dragging');
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });

    function onPointerMove(e) {
      if (!dragging) return;
      applyPosition(origX + (e.clientX - startX), origY + (e.clientY - startY));
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;
      player.classList.remove('mp-dragging');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      savePosition();
    }
  }

  // Re-clamp on window resize
  window.addEventListener('resize', () => {
    if (!player) return;
    const x = parseInt(player.style.left) || 0;
    const y = parseInt(player.style.top) || 0;
    applyPosition(x, y);
  });

  // ── Fetch tracks ───────────────────────────────────────────────────────────
  async function fetchTracks() {
    try {
      const res = await fetch('/api/music/tracks');
      const data = await res.json();
      tracks = data.tracks || [];
    } catch { tracks = []; }
  }

  // ── Playback ───────────────────────────────────────────────────────────────
  function updateUI() {
    if (!btnPlay) return;
    const list = getActiveList();
    const track = list[currentIndex];
    if (iconPlay) iconPlay.classList.toggle('hidden', playing);
    if (iconPause) iconPause.classList.toggle('hidden', !playing);
    if (elTitle) elTitle.textContent = track ? track.title : 'No track';
    if (elTitle) elTitle.title = track ? track.title : '';
    if (btnFav) {
      const isFav = track && favorites.includes(track.filename);
      btnFav.classList.toggle('mp-fav-active', !!isFav);
      const svg = btnFav.querySelector('svg');
      if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
    }
  }

  function loadTrack(index, autoplay) {
    const list = getActiveList();
    if (!list.length) { currentIndex = -1; audio.pause(); playing = false; updateUI(); return; }
    currentIndex = ((index % list.length) + list.length) % list.length;
    audio.src = list[currentIndex].url;
    if (autoplay && userInteracted) {
      audio.play().then(() => { playing = true; updateUI(); }).catch(() => {});
    } else {
      playing = false;
    }
    updateUI();
  }

  function play() {
    userInteracted = true;
    const list = getActiveList();
    if (!list.length) return;
    if (currentIndex < 0) currentIndex = 0;
    if (!audio.src || audio.src === location.href) audio.src = list[currentIndex].url;
    audio.play().then(() => { playing = true; updateUI(); }).catch(() => {});
  }

  function pause() { audio.pause(); playing = false; updateUI(); }

  function next() { userInteracted = true; loadTrack(currentIndex + 1, true); }

  function prev() {
    userInteracted = true;
    if (audio.currentTime > 3) { audio.currentTime = 0; if (!playing) play(); return; }
    loadTrack(currentIndex - 1, true);
  }

  audio.addEventListener('ended', next);

  // ── Event listeners ────────────────────────────────────────────────────────
  if (btnPlay) btnPlay.addEventListener('click', () => { playing ? pause() : play(); });
  if (btnNext) btnNext.addEventListener('click', next);
  if (btnPrev) btnPrev.addEventListener('click', prev);
  if (volumeSlider) volumeSlider.addEventListener('input', (e) => { audio.volume = e.target.value / 100; });

  if (btnFav) btnFav.addEventListener('click', () => {
    const list = getActiveList();
    const track = list[currentIndex];
    if (!track) return;
    const idx = favorites.indexOf(track.filename);
    if (idx >= 0) favorites.splice(idx, 1); else favorites.push(track.filename);
    saveFavorites();
    updateUI();
  });

  if (playlistToggle) {
    const toggleBtn = playlistToggle.querySelector('.mp-btn-playlist');
    if (toggleBtn) toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playlistDropdown?.classList.toggle('hidden');
    });
  }
  if (playlistDropdown) {
    playlistDropdown.addEventListener('click', (e) => {
      const opt = e.target.closest('.mp-playlist-opt');
      if (!opt) return;
      const val = opt.dataset.playlist;
      if (val === playlist) { playlistDropdown.classList.add('hidden'); return; }
      playlist = val;
      playlistDropdown.querySelectorAll('.mp-playlist-opt').forEach(b => b.classList.toggle('active', b.dataset.playlist === val));
      playlistDropdown.classList.add('hidden');
      loadFavorites();
      loadTrack(0, playing);
    });
  }
  document.addEventListener('click', () => { if (playlistDropdown) playlistDropdown.classList.add('hidden'); });

  // Autoplay guard
  document.addEventListener('click', () => { userInteracted = true; }, { once: true });
  document.addEventListener('keydown', () => { userInteracted = true; }, { once: true });

  // ── Seek bar ───────────────────────────────────────────────────────────────
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  let seeking = false;

  function updateSeekUI() {
    const cur = audio.currentTime || 0;
    const dur = audio.duration || 0;
    if (elTimeCur) elTimeCur.textContent = fmtTime(cur);
    if (elTimeDur) elTimeDur.textContent = fmtTime(dur);
    if (!seeking && dur > 0) {
      const pct = (cur / dur) * 100;
      if (seekFill) seekFill.style.width = pct + '%';
      if (seekThumb) seekThumb.style.left = pct + '%';
    }
  }

  audio.addEventListener('timeupdate', updateSeekUI);
  audio.addEventListener('loadedmetadata', updateSeekUI);
  audio.addEventListener('durationchange', updateSeekUI);

  function seekToFraction(frac) {
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(1, frac)) * audio.duration;
    updateSeekUI();
  }

  function getSeekFrac(e) {
    if (!seekBar) return 0;
    const rect = seekBar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  if (seekBar) {
    seekBar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      seeking = true;
      seekBar.classList.add('mp-seeking');
      seekBar.setPointerCapture(e.pointerId);
      const frac = getSeekFrac(e);
      if (seekFill) seekFill.style.width = (frac * 100) + '%';
      if (seekThumb) seekThumb.style.left = (frac * 100) + '%';
    });

    seekBar.addEventListener('pointermove', (e) => {
      if (!seeking) return;
      const frac = getSeekFrac(e);
      if (seekFill) seekFill.style.width = (frac * 100) + '%';
      if (seekThumb) seekThumb.style.left = (frac * 100) + '%';
      if (elTimeCur && isFinite(audio.duration)) elTimeCur.textContent = fmtTime(frac * audio.duration);
    });

    seekBar.addEventListener('pointerup', (e) => {
      if (!seeking) return;
      seeking = false;
      seekBar.classList.remove('mp-seeking');
      seekToFraction(getSeekFrac(e));
    });
  }

  // ── Admin panel integration ────────────────────────────────────────────────
  function isOwner() {
    try { const u = window.Auth?.getCurrentUser?.(); return u && (u.role === 'owner' || u.isOwner); }
    catch { return false; }
  }

  function showMusicNavIfOwner() {
    if (adminNavMusic) adminNavMusic.classList.toggle('hidden', !isOwner());
  }

  if (adminNavMusic) {
    adminNavMusic.addEventListener('click', () => {
      const panelList = $('adminPanelList');
      const userDetail = $('adminUserDetail');
      const fbPanel = $('adminFeedbackPanel');
      if (panelList) panelList.classList.add('hidden');
      if (userDetail) userDetail.classList.add('hidden');
      if (fbPanel) fbPanel.classList.add('hidden');
      if (adminMusicPanel) adminMusicPanel.classList.remove('hidden');
      const nav = $('adminModalNav');
      if (nav) nav.querySelectorAll('.admin-modal-nav-btn').forEach(b => b.classList.remove('active'));
      adminNavMusic.classList.add('active');
      loadAdminTrackList();
    });
  }

  ['adminNavUsers', 'adminNavFeedback'].forEach(id => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', () => { if (adminMusicPanel) adminMusicPanel.classList.add('hidden'); });
  });

  async function loadAdminTrackList() {
    if (!adminMusicList) return;
    adminMusicList.innerHTML = '<div class="admin-loading">Loading tracks…</div>';
    await fetchTracks();
    if (!tracks.length) { adminMusicList.innerHTML = '<div class="admin-loading">No tracks uploaded yet.</div>'; return; }
    adminMusicList.innerHTML = tracks.map(t => `
      <div class="admin-music-track" data-filename="${t.filename}">
        <span class="admin-music-track-title">${t.title}</span>
        <span class="admin-music-track-file">${t.filename}</span>
        <button class="btn-admin-music-del" data-filename="${t.filename}" title="Delete">&times;</button>
      </div>
    `).join('');

    adminMusicList.querySelectorAll('.btn-admin-music-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fn = btn.dataset.filename;
        if (!confirm('Delete "' + fn + '" permanently?')) return;
        btn.disabled = true;
        try {
          const res = await fetch('/api/music/tracks/' + encodeURIComponent(fn), {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + getToken() },
          });
          if (!res.ok) throw new Error('Delete failed');
          loadAdminTrackList();
          await fetchTracks();
          updateUI();
        } catch { alert('Failed to delete track'); btn.disabled = false; }
      });
    });
  }

  if (adminMusicFile) {
    adminMusicFile.addEventListener('change', () => {
      const file = adminMusicFile.files[0];
      if (adminMusicFileName) adminMusicFileName.textContent = file ? file.name : '';
      if (adminMusicUploadBtn) adminMusicUploadBtn.disabled = !file;
      if (adminMusicUploadStatus) adminMusicUploadStatus.textContent = '';
    });
  }
  if (adminMusicUploadBtn) {
    adminMusicUploadBtn.addEventListener('click', async () => {
      const file = adminMusicFile?.files[0];
      if (!file) return;
      adminMusicUploadBtn.disabled = true;
      if (adminMusicUploadStatus) adminMusicUploadStatus.textContent = 'Uploading…';
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/music/tracks', {
          method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: form,
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Upload failed'); }
        if (adminMusicUploadStatus) adminMusicUploadStatus.textContent = 'Uploaded!';
        if (adminMusicFile) adminMusicFile.value = '';
        if (adminMusicFileName) adminMusicFileName.textContent = '';
        loadAdminTrackList();
        await fetchTracks();
        if (currentIndex < 0) loadTrack(0, false);
      } catch (e) {
        if (adminMusicUploadStatus) adminMusicUploadStatus.textContent = 'Error: ' + e.message;
      }
      adminMusicUploadBtn.disabled = true;
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    loadFavorites();
    await fetchTracks();
    if (tracks.length) loadTrack(0, false);
    updateUI();
    showMusicNavIfOwner();
    restorePosition();
  }

  // Re-check owner on auth change
  const origAuthUpdateUI = window.Auth?.updateUI;
  if (origAuthUpdateUI) {
    window.Auth.updateUI = function () {
      origAuthUpdateUI.apply(this, arguments);
      showMusicNavIfOwner();
      loadFavorites();
      updateUI();
    };
  }
  window.addEventListener('auth-changed', () => { showMusicNavIfOwner(); loadFavorites(); updateUI(); });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── AI Track integration ───────────────────────────────────────────────
  let currentAiTrack = null;   // { id, title, audioUrl, lyrics, ... }
  let activeLyricLines = null; // parsed [{t, text}] or null

  /** Load an AI-generated track into the shared audio element */
  function loadAiTrack(aiTrack) {
    currentAiTrack = aiTrack;
    audio.src = aiTrack.audioUrl;
    userInteracted = true;
    audio.play().then(() => { playing = true; updateUI(); }).catch(() => {});
    if (elTitle) {
      elTitle.textContent = aiTrack.title || 'AI Track';
      elTitle.title = aiTrack.title || 'AI Track';
    }
    updateUI();
  }

  /** Set parsed lyric lines [{t: seconds, text}] for synced display, or null to clear */
  function setActiveLyrics(lines) {
    activeLyricLines = lines;
  }

  /** Called by music-studio.js on timeupdate to get highlight index */
  function getCurrentLyricIndex() {
    if (!activeLyricLines) return -1;
    const t = audio.currentTime;
    let idx = -1;
    for (let i = 0; i < activeLyricLines.length; i++) {
      if (activeLyricLines[i].t <= t) idx = i;
      else break;
    }
    return idx;
  }

  // Studio button — open handled by music-studio.js
  const btnStudio = $('mpStudio');
  if (btnStudio) {
    btnStudio.addEventListener('click', (e) => {
      e.stopPropagation();
      const event = new CustomEvent('music-studio:open');
      window.dispatchEvent(event);
    });
  }

  window.MusicPlayer = {
    play, pause, next, prev, fetchTracks, getActiveList,
    loadAiTrack,
    setActiveLyrics,
    getCurrentLyricIndex,
    getAudio: () => audio,
    getCurrentAiTrack: () => currentAiTrack,
  };
})();

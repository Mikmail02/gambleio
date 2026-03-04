/**
 * Gambly Bird - Provably fair Flappy Bird duel.
 * Physics: delta-time based. Pipes from seeded PRNG. Jump timestamps sent to server for validation.
 */
(function () {
  const GAME_WIDTH = 800;
  const GAME_HEIGHT = 600;
  const SCALE = GAME_HEIGHT / 1080;

  const GRAVITY = 2000 * SCALE;
  const JUMP_VELOCITY = -600 * SCALE;
  const MAX_FALL_VELOCITY = 800 * SCALE;
  const PIPE_SPEED = 300 * SCALE;
  const PIPE_DISTANCE = 350;
  const PIPE_GAP = 180;
  const PIPE_WIDTH = 70;
  const BIRD_RADIUS = 18;
  const BIRD_X = 120;

  function stringHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(31, h) + str.charCodeAt(i);
    }
    return (h >>> 0) || 1;
  }

  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSeededRandom(seedStr) {
    const h = stringHash(String(seedStr));
    return mulberry32(h);
  }

  function generatePipeGapY(random) {
    const minY = PIPE_GAP / 2;
    const maxY = GAME_HEIGHT - PIPE_GAP / 2;
    return minY + random() * (maxY - minY);
  }

  let canvas, ctx;
  let gameStartTime = 0;
  let lastFrameTime = 0;
  let birdY = 0;
  let birdVy = 0;
  let pipes = [];
  let score = 0;
  let gameOver = false;
  let jumpTimestamps = [];
  let random = null;
  let nextPipeX = 0;
  let passedPipes = new Set();
  let matchData = null;
  let rafId = null;

  const overlay = document.getElementById('gamblyBirdOverlay');
  const canvasWrap = document.getElementById('gamblyBirdCanvasWrap');
  const countdownEl = document.getElementById('gamblyBirdCountdown');
  const scoreEl = document.getElementById('gamblyBirdScore');
  const resultEl = document.getElementById('gamblyBirdResult');
  const resultClose = document.getElementById('gamblyBirdResultClose');

  function initCanvas() {
    if (!canvasWrap) return;
    canvas = document.getElementById('gamblyBirdCanvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'gamblyBirdCanvas';
      canvas.width = GAME_WIDTH;
      canvas.height = GAME_HEIGHT;
      canvasWrap.appendChild(canvas);
    }
    ctx = canvas.getContext('2d');
  }

  const PIPE_SPAWN_X = GAME_WIDTH + PIPE_WIDTH;

  function addPipe() {
    const gapY = generatePipeGapY(random);
    const topHeight = gapY - PIPE_GAP / 2;
    const bottomY = gapY + PIPE_GAP / 2;
    pipes.push({
      x: PIPE_SPAWN_X,
      topHeight,
      bottomY,
      gapY,
      passed: false,
    });
    nextPipeX = PIPE_SPAWN_X - PIPE_DISTANCE;
  }

  function checkCollision(by, bx) {
    if (by - BIRD_RADIUS < 0 || by + BIRD_RADIUS > GAME_HEIGHT) return true;
    for (const p of pipes) {
      if (p.x + PIPE_WIDTH < bx - BIRD_RADIUS || p.x > bx + BIRD_RADIUS) continue;
      if (by - BIRD_RADIUS < p.topHeight || by + BIRD_RADIUS > p.bottomY) return true;
    }
    return false;
  }

  function jump() {
    if (gameOver || !matchData) return;
    const now = performance.now();
    const t = Math.round(now - gameStartTime);
    jumpTimestamps.push(t);
    birdVy = JUMP_VELOCITY;
  }

  function update(dt) {
    if (gameOver) return;
    birdVy += GRAVITY * dt;
    if (birdVy > MAX_FALL_VELOCITY) birdVy = MAX_FALL_VELOCITY;
    birdY += birdVy * dt;

    const pipeDx = PIPE_SPEED * dt;
    for (const p of pipes) {
      p.x -= pipeDx;
      if (!p.passed && p.x + PIPE_WIDTH < BIRD_X - BIRD_RADIUS) {
        p.passed = true;
        score++;
      }
    }
    pipes = pipes.filter((p) => p.x + PIPE_WIDTH > 0);

    while (pipes.length === 0 || pipes[pipes.length - 1].x < nextPipeX) {
      addPipe();
    }

    if (checkCollision(birdY, BIRD_X)) {
      gameOver = true;
      endGame();
    }
  }

  function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    ctx.fillStyle = '#1a2332';
    for (let x = 0; x < GAME_WIDTH + 100; x += 40) {
      for (let y = 0; y < GAME_HEIGHT + 100; y += 40) {
        ctx.fillRect(x, y, 20, 20);
      }
    }

    ctx.fillStyle = '#00d4aa';
    ctx.strokeStyle = '#00a884';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(BIRD_X, birdY, BIRD_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2d5a3d';
    ctx.strokeStyle = '#3d7a4d';
    ctx.lineWidth = 2;
    for (const p of pipes) {
      ctx.fillRect(p.x, 0, PIPE_WIDTH, p.topHeight);
      ctx.strokeRect(p.x, 0, PIPE_WIDTH, p.topHeight);
      ctx.fillRect(p.x, p.bottomY, PIPE_WIDTH, GAME_HEIGHT - p.bottomY);
      ctx.strokeRect(p.x, p.bottomY, PIPE_WIDTH, GAME_HEIGHT - p.bottomY);
    }

    if (scoreEl) scoreEl.textContent = score;
  }

  function gameLoop(now) {
    if (!matchData || gameOver) return;
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    update(dt);
    draw();
    rafId = requestAnimationFrame(gameLoop);
  }

  async function pollForResult(challengeId, submitP) {
    const poll = async () => {
      const data = await window.Challenge?.pollChallengeResult?.(challengeId);
      if (data?.bothDone && submitP) {
        const label = data.winnerDisplayName || data.winner;
        submitP.textContent = data.winner
          ? (data.winner === (window.Auth?.user?.username || '') ? 'You won!' : label + ' wins!')
          : "It's a tie!";
        if (window.Chat?.loadMessages) window.Chat.loadMessages();
        return;
      }
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  }

  async function endGame() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (resultEl) {
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = '<p class="gambly-result-title">Game Over</p><p class="gambly-result-score">Score: ' + score + '</p><p class="gambly-result-submit">Submitting...</p><button type="button" class="btn-gambly-result-close hidden" id="gamblyBirdResultClose">Close</button>';
    }
    const challengeId = matchData?.challengeId;
    if (challengeId && window.Challenge?.submitGamblyResult) {
      const data = await window.Challenge.submitGamblyResult(challengeId, jumpTimestamps);
      const submitP = resultEl?.querySelector('.gambly-result-submit');
      const closeBtn = resultEl?.querySelector('.btn-gambly-result-close');
      if (submitP) {
        if (data && data.bothDone) {
          const label = data.winnerDisplayName || data.winner;
          submitP.textContent = data.winner
            ? (data.winner === (window.Auth?.user?.username || '') ? 'You won!' : label + ' wins!')
            : "It's a tie!";
        } else if (data) {
          submitP.textContent = 'Result submitted! Waiting for opponent...';
          pollForResult(challengeId, submitP);
        } else {
          submitP.textContent = 'Submit failed. Try again.';
        }
      }
      if (closeBtn) closeBtn.classList.remove('hidden');
    }
  }

  function startGame(seed, startTime) {
    random = createSeededRandom(seed);
    birdY = GAME_HEIGHT / 2;
    birdVy = 0;
    pipes = [];
    score = 0;
    gameOver = false;
    jumpTimestamps = [];
    passedPipes = new Set();
    nextPipeX = PIPE_SPAWN_X + 1;
    addPipe();

    const waitStart = () => {
      const now = Date.now();
      if (now < startTime - 50) {
        if (countdownEl) {
          const secs = Math.ceil((startTime - now) / 1000);
          countdownEl.textContent = secs > 0 ? secs : 'GO!';
          countdownEl.classList.remove('hidden');
        }
        requestAnimationFrame(waitStart);
        return;
      }
      if (countdownEl) countdownEl.classList.add('hidden');
      gameStartTime = performance.now();
      lastFrameTime = gameStartTime;
      rafId = requestAnimationFrame(gameLoop);
    };
    waitStart();
  }

  function show(seed, startTime, challengeId) {
    matchData = { seed, startTime, challengeId: challengeId || null };
    initCanvas();
    if (overlay) overlay.classList.remove('hidden');
    if (resultEl) resultEl.classList.add('hidden');
    if (canvasWrap) canvasWrap.focus();
    startGame(seed, startTime);
  }

  function hide() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (overlay) overlay.classList.add('hidden');
    matchData = null;
  }

  function bind() {
    if (canvasWrap) {
      canvasWrap.addEventListener('click', jump);
      canvasWrap.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
          e.preventDefault();
          jump();
        }
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && overlay && !overlay.classList.contains('hidden')) {
        e.preventDefault();
        jump();
      }
    });
    document.addEventListener('click', (e) => {
      if (e.target && e.target.matches('.btn-gambly-result-close')) hide();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.GamblyBird = {
    show,
    hide,
    startGame,
    createSeededRandom,
    GAME_WIDTH,
    GAME_HEIGHT,
    BIRD_RADIUS,
    BIRD_X,
    GRAVITY,
    JUMP_VELOCITY,
    MAX_FALL_VELOCITY,
    PIPE_SPEED,
    PIPE_DISTANCE,
    PIPE_GAP,
    PIPE_WIDTH,
    SCALE,
  };
})();

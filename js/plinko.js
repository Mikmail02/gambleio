/**
 * Plinko game: physics-based ball dropping with real-time animation.
 * Based on template logic but using our multipliers and risk levels.
 */
(function () {
  const pegBoard = document.getElementById('plinkoBoard');
  if (!pegBoard) return;

  const pegRows = 15;
  const pegSpacing = 36;
  const ballSize = 10;
  const gravity = 0.21;
  const bounceDamping = 0.557;
  const centerBias = 0.00028;
  const randomBias = 0.01;
  const airDragX = 0.9965;
  const airDragY = 0.9985;
  const DROP_DELAY_MS = 80;
  const VISUAL_TIME_SCALE = 0.55;
  const SPAWN_CONGESTION_LIMIT = 6;
  const SPAWN_ZONE_HEIGHT = 36;
  const BALL_FORCE_RESOLVE_MS = 20000;
  const SPAWN_POINTS_PER_SLOT = 3;
  const SPAWN_POINT_JITTER = 1.4;
  const SPAWN_POINT_WEIGHTS = [0.22, 0.56, 0.22];
  const SPAWN_TARGET_SPREAD = 0.92;
  const SPAWN_EDGE_POINT_OFFSET = 1.4;
  const SPAWN_WALL_SAFE_MARGIN = 6;
  const SPAWN_NON_EDGE_WALL_MARGIN = 40;
  const SPAWN_LANE_NUDGE_SCALE = 0.14;
  const SPAWN_EDGE_TARGET_WEIGHT_SCALE = 0.012;
  const SPAWN_NEAR_EDGE_TARGET_WEIGHT_SCALE = 0.28;
  const SPAWN_CENTER_TARGET_WEIGHT_SCALE = 1.2;
  const EDGE_SPAWN_CHANCE_BY_RISK = { low: 0.005, medium: 0.0025, high: 0.00125, extreme: 0.0003 };

  let balls = [];
  let lastDropTime = 0;
  let pegs = [];
  let multiplierBoxes = [];
  let rebuildTimer = null;

  function init() {
    if (!pegBoard) return;
    scheduleBoardRebuild();
  }

  function hasValidBoardSize() {
    return pegBoard.offsetWidth > 120 && pegBoard.offsetHeight > 120;
  }

  function isPlinkoVisible() {
    const page = document.getElementById('page-plinko');
    return !page || !page.classList.contains('hidden');
  }

  function clearBoardLayout() {
    pegs.forEach((peg) => {
      if (peg.parentNode) peg.parentNode.removeChild(peg);
    });
    multiplierBoxes.forEach((box) => {
      if (box.parentNode) box.parentNode.removeChild(box);
    });
    pegs = [];
    multiplierBoxes = [];
    pegBoard.querySelectorAll('.multiplier-tooltip').forEach((tip) => tip.remove());
  }

  function rebuildBoardLayout() {
    if (!hasValidBoardSize()) return false;
    clearBoardLayout();
    createPegs();
    createMultiplierBoxes();
    return true;
  }

  function scheduleBoardRebuild(maxAttempts = 18, intervalMs = 70) {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    const tryBuild = (attempt = 0) => {
      if (rebuildBoardLayout()) return;
      if (attempt >= maxAttempts) return;
      rebuildTimer = setTimeout(() => tryBuild(attempt + 1), intervalMs);
    };
    tryBuild(0);
  }

  function createPegs() {
    pegs = [];
    const startY = 50;
    for (let row = 0; row < pegRows; row++) {
      const count = 3 + row;
      const y = startY + row * pegSpacing;
      const rowWidth = (count - 1) * pegSpacing;
      const startX = (pegBoard.offsetWidth - rowWidth) / 2;
      for (let col = 0; col < count; col++) {
        const peg = document.createElement('div');
        peg.className = 'peg';
        peg.style.position = 'absolute';
        peg.style.left = `${startX + col * pegSpacing}px`;
        peg.style.top = `${y}px`;
        peg.style.width = '10px';
        peg.style.height = '10px';
        peg.style.borderRadius = '50%';
        peg.style.background = '#3d4656';
        peg.style.boxShadow = '0 0 4px rgba(0, 212, 170, 0.3)';
        pegBoard.appendChild(peg);
        pegs.push(peg);
      }
    }
  }

  function createMultiplierBoxes() {
    multiplierBoxes = [];
    const multipliers = Game.getMultipliers();
    const boxHeight = 28;
    const boxWidth = 36;
    const boxSpacing = pegSpacing;
    const lastRowY = 50 + (pegRows - 1) * pegSpacing;
    const boxY = lastRowY + 20;

    const totalWidth = multipliers.length * boxSpacing;
    const startX = (pegBoard.offsetWidth - totalWidth) / 2;

    for (let i = 0; i < multipliers.length; i++) {
      const box = document.createElement('div');
      box.className = 'multiplier-box';
      box.style.position = 'absolute';
      box.style.left = `${startX + i * boxSpacing}px`;
      box.style.top = `${boxY}px`;
      box.style.width = `${boxWidth}px`;
      box.style.height = `${boxHeight}px`;
      box.style.borderRadius = '4px';
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.fontSize = '9px';
      box.style.fontWeight = '600';
      box.style.color = '#fff';
      box.style.border = '1px solid rgba(255,255,255,0.2)';

      const mult = multipliers[i];
      if (mult >= 2) {
        box.style.background = '#00d4aa';
      } else if (mult <= 0.5) {
        box.style.background = '#ff4757';
      } else {
        box.style.background = '#ffa502';
      }

      box.textContent = mult + '×';
      box.dataset.multiplier = mult.toString();
      box.dataset.index = i.toString();
      
      const odds = Game.getSlotOddsPercent();
      const oddsPercent = odds[i] || 0;
      box.dataset.odds = oddsPercent.toString();
      box.title = `${oddsPercent}% chance`;
      
      setupMultiplierBoxHover(box, oddsPercent);
      
      pegBoard.appendChild(box);
      multiplierBoxes.push(box);
    }
  }

  function applyGlow(peg) {
    peg.style.boxShadow = '0 0 12px rgba(0, 212, 170, 0.8)';
    setTimeout(() => {
      peg.style.boxShadow = '0 0 4px rgba(0, 212, 170, 0.3)';
    }, 150);
  }

  function applyMultiplierGlow(box) {
    const originalBoxShadow = box.style.boxShadow;
    box.style.boxShadow = '0 0 20px rgba(255, 255, 255, 0.8)';
    box.style.transform = 'scale(1.1)';
    setTimeout(() => {
      box.style.boxShadow = originalBoxShadow;
      box.style.transform = 'scale(1)';
    }, 500);
  }

  function getSpawnCongestionCount() {
    return balls.reduce((count, b) => {
      if (!b || !b.parentNode) return count;
      const top = parseFloat(b.style.top || '0');
      return top < SPAWN_ZONE_HEIGHT ? count + 1 : count;
    }, 0);
  }

  function sampleWeightedIndex(weights) {
    if (!Array.isArray(weights) || !weights.length) return 0;
    let total = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = Number(weights[i]);
      if (w > 0) total += w;
    }
    if (total <= 0) return Math.floor(Math.random() * weights.length);
    let roll = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = Math.max(0, Number(weights[i]) || 0);
      if (roll < w) return i;
      roll -= w;
    }
    return weights.length - 1;
  }

  function getSpawnTargetWeights() {
    const base = (Game.getSlotOddsPercent() || []).map((v) => Math.max(0, Number(v) || 0));
    if (!base.length) return [1];
    const last = base.length - 1;
    const center = Math.floor(last / 2);
    if (last >= 0) {
      base[0] *= SPAWN_EDGE_TARGET_WEIGHT_SCALE;
      base[last] *= SPAWN_EDGE_TARGET_WEIGHT_SCALE;
    }
    if (last >= 1) {
      base[1] *= SPAWN_NEAR_EDGE_TARGET_WEIGHT_SCALE;
      base[last - 1] *= SPAWN_NEAR_EDGE_TARGET_WEIGHT_SCALE;
    }
    for (let i = Math.max(0, center - 1); i <= Math.min(last, center + 1); i++) {
      base[i] *= SPAWN_CENTER_TARGET_WEIGHT_SCALE;
    }
    return base;
  }

  function getHorizontalBallBounds() {
    if (!multiplierBoxes.length) {
      const fallbackMax = Math.max(0, pegBoard.offsetWidth - ballSize);
      return { minLeft: 0, maxLeft: fallbackMax };
    }
    const leftBox = multiplierBoxes[0];
    const rightBox = multiplierBoxes[multiplierBoxes.length - 1];
    const minLeft = parseFloat(leftBox.style.left);
    const maxLeft = parseFloat(rightBox.style.left) + 36 - ballSize;
    return { minLeft, maxLeft };
  }

  function getTopPegReachCenters() {
    if (!pegs.length) {
      const center = pegBoard.offsetWidth / 2;
      return { leftCenter: center - 24, rightCenter: center + 24 };
    }
    let minTop = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pegs.length; i++) {
      const top = parseFloat(pegs[i].style.top || '0');
      if (top < minTop) minTop = top;
    }
    const firstRow = pegs.filter((p) => Math.abs(parseFloat(p.style.top || '0') - minTop) < 0.5);
    if (!firstRow.length) {
      const center = pegBoard.offsetWidth / 2;
      return { leftCenter: center - 24, rightCenter: center + 24 };
    }
    let leftCenter = Number.POSITIVE_INFINITY;
    let rightCenter = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < firstRow.length; i++) {
      const center = parseFloat(firstRow[i].style.left || '0') + 5;
      if (center < leftCenter) leftCenter = center;
      if (center > rightCenter) rightCenter = center;
    }
    return { leftCenter, rightCenter };
  }

  function getSpawnPlan() {
    const { minLeft, maxLeft } = getHorizontalBallBounds();
    const targetWeights = getSpawnTargetWeights();
    const targetSlotIndex = sampleWeightedIndex(targetWeights);
    const slotCount = Math.max(1, multiplierBoxes.length);
    const slotCenter = parseFloat(multiplierBoxes[targetSlotIndex].style.left) + 18;
    const boardCenter = pegBoard.offsetWidth / 2;
    const slotSpan = Math.max(1, (parseFloat(multiplierBoxes[slotCount - 1].style.left) + 18) - (parseFloat(multiplierBoxes[0].style.left) + 18));
    const normalizedSlot = ((slotCenter - boardCenter) / (slotSpan / 2)) || 0;

    const { leftCenter, rightCenter } = getTopPegReachCenters();
    const topReachHalf = Math.max(12, (rightCenter - leftCenter) / 2 + 10);
    const baseCenter = boardCenter + (normalizedSlot * topReachHalf * SPAWN_TARGET_SPREAD);
    const safeCenterMin = minLeft + ballSize / 2 + 2;
    const safeCenterMax = maxLeft + ballSize / 2 - 2;
    const isEdgeTarget = targetSlotIndex === 0 || targetSlotIndex === slotCount - 1;
    const preferredCenterMin = safeCenterMin + (isEdgeTarget ? SPAWN_WALL_SAFE_MARGIN : SPAWN_NON_EDGE_WALL_MARGIN);
    const preferredCenterMax = safeCenterMax - (isEdgeTarget ? SPAWN_WALL_SAFE_MARGIN : SPAWN_NON_EDGE_WALL_MARGIN);
    const activeCenterMin = preferredCenterMin < preferredCenterMax ? preferredCenterMin : safeCenterMin;
    const activeCenterMax = preferredCenterMin < preferredCenterMax ? preferredCenterMax : safeCenterMax;
    const clampedBaseCenter = Math.max(activeCenterMin, Math.min(activeCenterMax, baseCenter));

    const candidates = [];
    const baseWeights = SPAWN_POINTS_PER_SLOT === 3 ? SPAWN_POINT_WEIGHTS : [1];
    const offsets = SPAWN_POINTS_PER_SLOT === 3
      ? [-SPAWN_POINT_JITTER, 0, SPAWN_POINT_JITTER]
      : [0];
    for (let i = 0; i < offsets.length; i++) {
      const center = Math.max(safeCenterMin, Math.min(safeCenterMax, clampedBaseCenter + offsets[i]));
      candidates.push({ center, weight: baseWeights[i] });
    }

    if (isEdgeTarget) {
      const riskLevel = (typeof Game !== 'undefined' && Game.getPlinkoRiskLevel) ? Game.getPlinkoRiskLevel() : 'low';
      const edgeChance = EDGE_SPAWN_CHANCE_BY_RISK[riskLevel] != null ? EDGE_SPAWN_CHANCE_BY_RISK[riskLevel] : EDGE_SPAWN_CHANCE_BY_RISK.low;
      const edgeCenter = Math.max(
        safeCenterMin,
        Math.min(safeCenterMax, clampedBaseCenter + Math.sign(normalizedSlot) * SPAWN_EDGE_POINT_OFFSET)
      );
      candidates.push({ center: edgeCenter, weight: edgeChance });
    }

    const selected = candidates[sampleWeightedIndex(candidates.map((c) => c.weight))] || candidates[1] || candidates[0];
    const spawnLeft = Math.max(minLeft, Math.min(maxLeft, selected.center - ballSize / 2));
    const laneNudge = Math.max(-0.42, Math.min(0.42, normalizedSlot * SPAWN_LANE_NUDGE_SCALE));

    return { spawnLeft, laneNudge, targetSlotIndex };
  }

  function dropBall(betAmount, onComplete) {
    if (!pegBoard) return false;
    if (balls.length >= 25) return false;
    if (getSpawnCongestionCount() >= SPAWN_CONGESTION_LIMIT) {
      return false;
    }
    if (!pegs.length || !multiplierBoxes.length || !hasValidBoardSize()) {
      scheduleBoardRebuild();
      return false;
    }

    const now = Date.now();
    const elapsed = now - lastDropTime;
    if (elapsed < DROP_DELAY_MS) {
      const wait = DROP_DELAY_MS - elapsed;
      setTimeout(() => dropBall(betAmount, onComplete), wait);
      return true;
    }
    lastDropTime = now;

    const ball = document.createElement('div');
    ball.className = 'ball';
    ball.style.position = 'absolute';
    const spawnPlan = getSpawnPlan();
    ball.style.left = `${spawnPlan.spawnLeft}px`;
    ball.style.top = '0px';
    ball.style.width = `${ballSize}px`;
    ball.style.height = `${ballSize}px`;
    ball.style.borderRadius = '50%';
    ball.style.background = 'radial-gradient(circle at 30% 30%, #fff, #c4c8cc)';
    ball.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
    ball.style.pointerEvents = 'none';
    ball.dataset.betAmount = betAmount.toString();
    ball.dataset.createdAt = String(Date.now());
    ball.dataset.resolved = '0';
    ball.dataset.spawnSlot = String(spawnPlan.targetSlotIndex);
    pegBoard.appendChild(ball);
    balls.push(ball);

    let velocityY = 0;
    let velocityX = ((Math.random() - 0.5) * 1.1) + spawnPlan.laneNudge;
    ball._forceResolveTimer = setTimeout(() => {
      if (!ball.parentNode) return;
      // Failsafe: never leave a paid ball unresolved.
      finishBall(ball, parseFloat(ball.style.left || '0'), betAmount, onComplete);
    }, BALL_FORCE_RESOLVE_MS);
    animateBall(ball, velocityX, velocityY, betAmount, onComplete);
    return true;
  }

  function animateBall(ball, velocityX, velocityY, betAmount, onComplete) {
    let lastTop = parseFloat(ball.style.top || '0');
    let lastLeft = parseFloat(ball.style.left || '0');
    let nearSpawnStuckFrames = 0;

    function dropBallFrame() {
      const centerRegion = pegBoard.offsetWidth * 0.2;
      const distanceFromCenter = Math.abs(parseFloat(ball.style.left) - (pegBoard.offsetWidth / 2));

      if (distanceFromCenter > centerRegion) {
        const biasStrength = Math.min(1, (distanceFromCenter - centerRegion) / centerRegion) * 0.28;
        const bias = (parseFloat(ball.style.left) < pegBoard.offsetWidth / 2) ? centerBias : -centerBias;
        velocityX += bias * biasStrength * VISUAL_TIME_SCALE;
      }

      velocityX += ((Math.random() - 0.5) * randomBias) * VISUAL_TIME_SCALE;
      velocityY += gravity * VISUAL_TIME_SCALE;
      velocityX *= airDragX;
      velocityY *= airDragY;
      velocityX = Math.max(-2.4, Math.min(2.4, velocityX));
      velocityY = Math.max(-4.5, Math.min(4.5, velocityY));

      let newTop = parseFloat(ball.style.top) + velocityY * VISUAL_TIME_SCALE;
      let newLeft = parseFloat(ball.style.left) + velocityX * VISUAL_TIME_SCALE;

      const leftBox = multiplierBoxes[0];
      const rightBox = multiplierBoxes[multiplierBoxes.length - 1];
      const wallLeft = parseFloat(leftBox.style.left);
      const wallRight = parseFloat(rightBox.style.left) + 36 - ballSize;

      if (newLeft < wallLeft) {
        newLeft = wallLeft;
        velocityX *= -bounceDamping;
      }
      if (newLeft > wallRight) {
        newLeft = wallRight;
        velocityX *= -bounceDamping;
      }

      pegs.forEach(peg => {
        const pegLeft = parseFloat(peg.style.left);
        const pegTop = parseFloat(peg.style.top);
        const pegSize = 10;
        const dx = (newLeft + ballSize / 2) - (pegLeft + pegSize / 2);
        const dy = (newTop + ballSize / 2) - (pegTop + pegSize / 2);
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < (ballSize / 2 + pegSize / 2)) {
          const angle = Math.atan2(dy, dx);
          const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
          const bounceSpeed = speed * bounceDamping;
          velocityX = Math.cos(angle) * bounceSpeed;
          velocityY = Math.sin(angle) * bounceSpeed;
          newLeft = parseFloat(ball.style.left) + velocityX;
          newTop = parseFloat(ball.style.top) + velocityY;
          applyGlow(peg);
        }
      });

      const boxY = parseFloat(multiplierBoxes[0].style.top);
      const moveDistance = Math.abs(newTop - lastTop) + Math.abs(newLeft - lastLeft);
      if (newTop < SPAWN_ZONE_HEIGHT + 10 && moveDistance < 0.12) {
        nearSpawnStuckFrames++;
      } else {
        nearSpawnStuckFrames = 0;
      }
      if (nearSpawnStuckFrames > 20) {
        // Kick balls out of the spawn cluster if they lock.
        velocityY += 1.1 * VISUAL_TIME_SCALE;
        velocityX += ((Math.random() - 0.5) * 1.2) * VISUAL_TIME_SCALE;
        newTop += 1.5 * VISUAL_TIME_SCALE;
        nearSpawnStuckFrames = 0;
      }

      if (newTop >= boxY - ballSize) {
        finishBall(ball, newLeft, betAmount, onComplete);
        return;
      }

      ball.style.left = `${newLeft}px`;
      ball.style.top = `${newTop}px`;
      lastTop = newTop;
      lastLeft = newLeft;
      requestAnimationFrame(dropBallFrame);
    }

    requestAnimationFrame(dropBallFrame);
  }

  function finishBall(ball, newLeft, betAmount, onComplete) {
    if (!ball || ball.dataset.resolved === '1') return;
    ball.dataset.resolved = '1';
    if (ball._forceResolveTimer) {
      clearTimeout(ball._forceResolveTimer);
      ball._forceResolveTimer = null;
    }
    if (ball.parentNode) {
      pegBoard.removeChild(ball);
    }
    balls = balls.filter(b => b !== ball);

    const ballCenterX = newLeft + ballSize / 2;
    let resolvedIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < multiplierBoxes.length; i++) {
      const boxLeft = parseFloat(multiplierBoxes[i].style.left);
      const boxCenter = boxLeft + 18;
      const d = Math.abs(ballCenterX - boxCenter);
      if (d < minDistance) {
        minDistance = d;
        resolvedIndex = i;
      }
    }
    const resolvedBox = multiplierBoxes[resolvedIndex];
    const multiplier = resolvedBox ? parseFloat(resolvedBox.dataset.multiplier) : 1;
    const winAmount = betAmount * multiplier;

    if (resolvedBox) applyMultiplierGlow(resolvedBox);
    if (onComplete) {
      onComplete({ slotIndex: resolvedIndex, multiplier, winAmount });
    }
  }

  function updateMultipliers() {
    if (!hasValidBoardSize()) {
      scheduleBoardRebuild();
      return;
    }
    multiplierBoxes.forEach((box) => {
      if (box.parentNode) pegBoard.removeChild(box);
    });
    multiplierBoxes = [];
    createMultiplierBoxes();
  }
  
  function setupMultiplierBoxHover(box, oddsPercent) {
    let tooltip = null;
    box.addEventListener('mouseenter', () => {
      if (tooltip) return;
      tooltip = document.createElement('div');
      tooltip.className = 'multiplier-tooltip';
      tooltip.textContent = `${oddsPercent}%`;
      const boxLeft = parseFloat(box.style.left);
      const boxTop = parseFloat(box.style.top);
      tooltip.style.left = `${boxLeft + 36 / 2}px`;
      tooltip.style.top = `${boxTop - 30}px`;
      pegBoard.appendChild(tooltip);
    });
    
    box.addEventListener('mouseleave', () => {
      if (tooltip && tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
      tooltip = null;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

  window.addEventListener('resize', () => {
    if (isPlinkoVisible()) scheduleBoardRebuild(8, 60);
  });

  window.Plinko = {
    dropBall,
    updateMultipliers,
    recenterBoard: () => scheduleBoardRebuild(18, 70),
    getActiveBallCount: () => balls.length,
    maxActiveBalls: 25,
    isReplaysReady: () => true,
    onReplaysReady: null,
  };
})();

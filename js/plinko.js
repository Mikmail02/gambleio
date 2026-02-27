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
  const gravity = 0.52;
  const bounceDamping = 0.44;
  const centerBias = 0.0005;
  const randomBias = 0.018;

  let balls = [];
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

  function dropBall(betAmount, onComplete) {
    if (!pegBoard) return false;
    if (balls.length >= 25) return false;
    if (!pegs.length || !multiplierBoxes.length || !hasValidBoardSize()) {
      scheduleBoardRebuild();
      return false;
    }

    const ball = document.createElement('div');
    ball.className = 'ball';
    ball.style.position = 'absolute';
    ball.style.left = `${pegBoard.offsetWidth / 2 - ballSize / 2}px`;
    ball.style.top = '0px';
    ball.style.width = `${ballSize}px`;
    ball.style.height = `${ballSize}px`;
    ball.style.borderRadius = '50%';
    ball.style.background = 'radial-gradient(circle at 30% 30%, #fff, #c4c8cc)';
    ball.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
    ball.style.pointerEvents = 'none';
    ball.dataset.betAmount = betAmount.toString();
    pegBoard.appendChild(ball);
    balls.push(ball);

    let velocityY = 0;
    let velocityX = (Math.random() - 0.5) * 2;

    animateBall(ball, velocityX, velocityY, betAmount, onComplete);
    return true;
  }

  function animateBall(ball, velocityX, velocityY, betAmount, onComplete) {
    function dropBallFrame() {
      const centerRegion = pegBoard.offsetWidth * 0.2;
      const distanceFromCenter = Math.abs(parseFloat(ball.style.left) - (pegBoard.offsetWidth / 2));

      if (distanceFromCenter < centerRegion) {
        const biasStrength = (centerRegion - distanceFromCenter) / centerRegion * 0.2;
        const bias = (parseFloat(ball.style.left) < pegBoard.offsetWidth / 2) ? centerBias : -centerBias;
        velocityX += bias * biasStrength;
      }

      velocityX += (Math.random() - 0.5) * randomBias;
      velocityY += gravity;

      let newTop = parseFloat(ball.style.top) + velocityY;
      let newLeft = parseFloat(ball.style.left) + velocityX;

      if (newLeft < 0) {
        newLeft = 0;
        velocityX *= -bounceDamping;
      }
      if (newLeft > pegBoard.offsetWidth - ballSize) {
        newLeft = pegBoard.offsetWidth - ballSize;
        velocityX *= -bounceDamping;
      }

      balls.forEach(otherBall => {
        if (otherBall !== ball && otherBall.parentNode) {
          const dx = newLeft - parseFloat(otherBall.style.left);
          const dy = newTop - parseFloat(otherBall.style.top);
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < ballSize) {
            const angle = Math.atan2(dy, dx);
            const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
            const bounceSpeed = speed * bounceDamping;
            velocityX = Math.cos(angle) * bounceSpeed;
            velocityY = Math.sin(angle) * bounceSpeed;
            newLeft = parseFloat(ball.style.left) + velocityX;
            newTop = parseFloat(ball.style.top) + velocityY;
          }
        }
      });

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
      if (newTop >= boxY - ballSize) {
        finishBall(ball, newLeft, betAmount, onComplete);
        return;
      }

      ball.style.left = `${newLeft}px`;
      ball.style.top = `${newTop}px`;
      requestAnimationFrame(dropBallFrame);
    }

    requestAnimationFrame(dropBallFrame);
  }

  function finishBall(ball, newLeft, betAmount, onComplete) {
    if (ball.parentNode) {
      pegBoard.removeChild(ball);
    }
    balls = balls.filter(b => b !== ball);

    const ballCenterX = newLeft + ballSize / 2;
    let hitMultiplier = false;
    let slotIndex = -1;
    let multiplier = 0;

    for (let i = 0; i < multiplierBoxes.length; i++) {
      const box = multiplierBoxes[i];
      const boxLeft = parseFloat(box.style.left);
      const boxRight = boxLeft + 36;

      if (ballCenterX >= boxLeft && ballCenterX <= boxRight) {
        hitMultiplier = true;
        slotIndex = i;
        multiplier = parseFloat(box.dataset.multiplier);
        const winAmount = betAmount * multiplier;
        applyMultiplierGlow(box);
        if (onComplete) {
          onComplete({ slotIndex: i, multiplier, winAmount });
        }
        break;
      }
    }

    if (!hitMultiplier) {
      if (onComplete) {
        onComplete({ slotIndex: -1, multiplier: 1, winAmount: betAmount });
      }
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

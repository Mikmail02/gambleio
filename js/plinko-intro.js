/**
 * Plinko intro: ball falls into 1000x bowl (same physics as real board),
 * board+bowl disappear, logo slams in, cracks, neon, fade out.
 */
(function () {
  const intro = document.getElementById('plinkoIntro');
  const board = document.getElementById('plinkoIntroBoard');
  const miniBoard = document.getElementById('plinkoIntroMiniBoard');
  const ball = document.getElementById('plinkoIntroBall');
  const bowl = document.getElementById('plinkoIntroBowl');
  const logo = document.getElementById('plinkoIntroLogo');
  const cracks = document.getElementById('plinkoIntroCracks');

  if (!intro || !board || !miniBoard || !ball || !bowl || !logo || !cracks) return;

  // Physics: lavere gravity enn ekte brett for roligere intro
  const gravity = 0.14;
  const bounceDamping = 0.5;
  const airDragX = 0.9965;
  const airDragY = 0.9985;
  const centerBias = 0.00028;
  const randomBias = 0.01;
  const VISUAL_TIME_SCALE = 0.75;

  const ballSize = 7;
  const pegSize = 10;
  const pegSpacing = 28;
  const MINI_BOARD_HEIGHT = 200;
  const MINI_BOARD_WIDTH = 400;
  const BOWL_LEFT = 0;
  const BOWL_RIGHT = MINI_BOARD_WIDTH;
  const WALL_LEFT = 0;
  const WALL_RIGHT = MINI_BOARD_WIDTH - ballSize;

  let animId = null;
  let pegs = [];

  function createMiniPegs() {
    pegs.forEach((p) => p.remove());
    pegs = [];
    const startY = 25;
    for (let row = 0; row < 4; row++) {
      const count = 3 + row;
      const y = startY + row * pegSpacing;
      const rowWidth = (count - 1) * pegSpacing;
      const startX = (MINI_BOARD_WIDTH - rowWidth) / 2;
      for (let col = 0; col < count; col++) {
        const peg = document.createElement('div');
        peg.className = 'plinko-intro-peg';
        peg.style.left = `${startX + col * pegSpacing}px`;
        peg.style.top = `${y}px`;
        miniBoard.appendChild(peg);
        pegs.push(peg);
      }
    }
  }

  function runIntro(onComplete) {
    intro.classList.remove('plinko-intro-done');
    intro.style.opacity = '1';
    intro.style.visibility = 'visible';

    createMiniPegs();
    miniBoard.classList.remove('plinko-intro-mini-out');
    bowl.classList.remove('plinko-intro-bowl-out');
    logo.classList.remove('plinko-intro-logo-slam', 'plinko-intro-logo-neon', 'plinko-intro-logo-out');
    cracks.classList.remove('plinko-intro-cracks-visible', 'plinko-intro-cracks-out');

    let velocityX = (Math.random() - 0.5) * 1.1;
    let velocityY = 0;
    let lastLeft = MINI_BOARD_WIDTH / 2 - ballSize / 2 + (Math.random() - 0.5) * 40;
    let lastTop = -15;

    ball.style.transform = `translate3d(${lastLeft}px,${lastTop}px,0)`;
    ball.style.opacity = '1';

    const startTime = performance.now();

    function frame() {
      const elapsed = performance.now() - startTime;

      // Center bias (same as real board)
      const centerRegion = MINI_BOARD_WIDTH * 0.2;
      const distanceFromCenter = Math.abs(lastLeft - (MINI_BOARD_WIDTH / 2));
      if (distanceFromCenter > centerRegion) {
        const biasStrength = Math.min(1, (distanceFromCenter - centerRegion) / centerRegion) * 0.28;
        const bias = (lastLeft < MINI_BOARD_WIDTH / 2) ? centerBias : -centerBias;
        velocityX += bias * biasStrength * VISUAL_TIME_SCALE;
      }
      velocityX += ((Math.random() - 0.5) * randomBias) * VISUAL_TIME_SCALE;

      velocityY += gravity * VISUAL_TIME_SCALE;
      velocityX *= airDragX;
      velocityY *= airDragY;
      velocityX = Math.max(-2.4, Math.min(2.4, velocityX));
      velocityY = Math.max(-4.5, Math.min(4.5, velocityY));

      let newTop = lastTop + velocityY * VISUAL_TIME_SCALE;
      let newLeft = lastLeft + velocityX * VISUAL_TIME_SCALE;

      // Invisible walls (same idea as real board – ball cannot leave)
      if (newLeft < WALL_LEFT) {
        newLeft = WALL_LEFT;
        velocityX *= -bounceDamping;
      }
      if (newLeft > WALL_RIGHT) {
        newLeft = WALL_RIGHT;
        velocityX *= -bounceDamping;
      }

      // Bunn: ballen holdes innenfor brettet (skålen er like bred som brettet)
      const ballBottom = newTop + ballSize;
      if (ballBottom >= MINI_BOARD_HEIGHT - 2) {
        newTop = MINI_BOARD_HEIGHT - ballSize - 2;
        newLeft = Math.max(WALL_LEFT, Math.min(WALL_RIGHT, newLeft));
        velocityX *= 0.6;
      }

      // Peg collisions (same physics as real: bounce with damping)
      pegs.forEach((peg) => {
        const pegLeft = parseFloat(peg.style.left);
        const pegTop = parseFloat(peg.style.top);
        const dx = (newLeft + ballSize / 2) - (pegLeft + pegSize / 2);
        const dy = (newTop + ballSize / 2) - (pegTop + pegSize / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < ballSize / 2 + pegSize / 2) {
          const angle = Math.atan2(dy, dx);
          const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
          const bounceSpeed = speed * bounceDamping;
          velocityX = Math.cos(angle) * bounceSpeed;
          velocityY = Math.sin(angle) * bounceSpeed;
          newLeft = lastLeft + velocityX;
          newTop = lastTop + velocityY;
        }
      });

      const ballCenterX = newLeft + ballSize / 2;
      const ballBottomCheck = newTop + ballSize;
      const inBowlX = ballCenterX >= BOWL_LEFT - 5 && ballCenterX <= BOWL_RIGHT + 5;
      const inBowlY = ballBottomCheck >= MINI_BOARD_HEIGHT - 15;
      const forceLandAt = 12000;

      if ((inBowlX && inBowlY) || elapsed > forceLandAt) {
        if (animId) cancelAnimationFrame(animId);
        ball.style.opacity = '0';
        ball.style.transition = 'opacity 0.2s ease';

        setTimeout(() => {
          miniBoard.classList.add('plinko-intro-mini-out');
          bowl.classList.add('plinko-intro-bowl-out');

          setTimeout(() => {
            logo.classList.add('plinko-intro-logo-slam');
            setTimeout(() => {
              cracks.classList.add('plinko-intro-cracks-visible');
              logo.classList.add('plinko-intro-logo-neon');

              setTimeout(() => {
                logo.classList.add('plinko-intro-logo-out');
                cracks.classList.add('plinko-intro-cracks-out');

                setTimeout(() => {
                  intro.classList.add('plinko-intro-done');
                  if (onComplete) onComplete();
                }, 800);
              }, 1800);
            }, 100);
          }, 400);
        }, 150);
        return;
      }

      lastTop = newTop;
      lastLeft = newLeft;
      ball.style.transform = `translate3d(${newLeft}px,${newTop}px,0)`;
      animId = requestAnimationFrame(frame);
    }
    animId = requestAnimationFrame(frame);
  }

  window.PlinkoIntro = { runIntro };
})();

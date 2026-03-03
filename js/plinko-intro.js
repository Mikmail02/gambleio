/**
 * Plinko intro: ball falls randomly into 1000x bowl, board+bowl disappear,
 * logo slams in, cracks appear, neon glow, fade out.
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

  const gravity = 0.4;
  const ballSize = 10;
  const pegSize = 6;
  const pegSpacing = 20;
  let animId = null;
  let pegs = [];

  function createMiniPegs() {
    pegs.forEach((p) => p.remove());
    pegs = [];
    const startY = 25;
    for (let row = 0; row < 4; row++) {
      const count = 2 + row;
      const y = startY + row * pegSpacing;
      const rowWidth = (count - 1) * pegSpacing;
      const startX = (board.offsetWidth - rowWidth) / 2;
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

    const boardW = board.offsetWidth || 400;
    const boardH = board.offsetHeight || 360;
    const bowlW = 120;
    const bowlH = 36;
    const bowlX = (boardW - bowlW) / 2;
    const bowlY = boardH - bowlH - 20;

    let velocityX = (Math.random() - 0.5) * 1.2;
    let velocityY = 0;
    let lastLeft = boardW / 2 - ballSize / 2 + (Math.random() - 0.5) * 60;
    let lastTop = -15;

    ball.style.transform = `translate3d(${lastLeft}px,${lastTop}px,0)`;
    ball.style.opacity = '1';

    const startTime = performance.now();

    function frame() {
      const elapsed = performance.now() - startTime;
      velocityY += gravity;
      velocityX *= 0.998;
      velocityY = Math.min(velocityY, 6);

      let newTop = lastTop + velocityY;
      let newLeft = lastLeft + velocityX;

      const wallLeft = 8;
      const wallRight = boardW - ballSize - 8;
      if (newLeft < wallLeft) {
        newLeft = wallLeft;
        velocityX *= -0.6;
      }
      if (newLeft > wallRight) {
        newLeft = wallRight;
        velocityX *= -0.6;
      }

      pegs.forEach((peg) => {
        const pegLeft = parseFloat(peg.style.left);
        const pegTop = parseFloat(peg.style.top);
        const dx = (newLeft + ballSize / 2) - (pegLeft + pegSize / 2);
        const dy = (newTop + ballSize / 2) - (pegTop + pegSize / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < ballSize / 2 + pegSize / 2) {
          const angle = Math.atan2(dy, dx);
          const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY) * 0.6;
          velocityX = Math.cos(angle) * speed;
          velocityY = Math.sin(angle) * speed;
          newLeft = lastLeft + velocityX;
          newTop = lastTop + velocityY;
        }
      });

      const ballCenterX = newLeft + ballSize / 2;
      const ballBottom = newTop + ballSize;
      const inBowlX = ballCenterX >= bowlX - 5 && ballCenterX <= bowlX + bowlW + 5;
      const inBowlY = ballBottom >= bowlY - 5 && ballBottom <= bowlY + bowlH + 15;
      const forceLandAt = 8000;

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

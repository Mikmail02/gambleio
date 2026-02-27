/**
 * Slots: Game listing and slot machine integration
 */
(function () {
  const slotsGrid = document.getElementById('slotsGrid');
  const slotBackBtn = document.getElementById('slotBackBtn');
  const slotSpinBtn = document.getElementById('slotSpinBtn');
  const slotBetInput = document.getElementById('slotBet');
  const slotGameArea = document.getElementById('slotGameArea');
  const slotGameTitle = document.getElementById('slotGameTitle');

  // Slot games data
  const slotGames = [
    {
      id: 'circular-slots',
      name: 'Circular Slots',
      description: 'Classic circular slot machine with 5 reels. Click to spin and stop each reel. Match 3+ symbols to win!',
      emoji: '🎰',
      symbols: ['🍋', '🍊', '🍉', '🍈', '🍇', '🥝', '🍓', '🍒', '🌟', '🍀', '💎', '🎰'],
      image: '🎰' // Will show slot machine preview
    }
  ];

  let currentSlotGame = null;
  let currentBet = 10;
  let slotMachine = null;
  let isSpinning = false;

  // Initialize slots listing
  function renderSlotsList() {
    if (!slotsGrid) return;
    slotsGrid.innerHTML = slotGames.map(game => `
      <div class="slot-game-card" data-game-id="${game.id}">
        <div class="slot-game-card-image">
          <div class="slot-preview-machine">
            <div class="slot-preview-reels-container">
              ${game.symbols.slice(0, 5).map((s, i) => `
                <div class="slot-preview-reel" style="--index: ${i}">
                  <div class="slot-preview-symbol">${s}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <button class="slot-game-card-play" type="button">Play Game</button>
        </div>
        <div class="slot-game-card-info">
          <div class="slot-game-card-name">${game.name}</div>
          <div class="slot-game-card-description">${game.description}</div>
        </div>
      </div>
    `).join('');

    // Simple click handler - just like navigation tabs
    slotsGrid.addEventListener('click', function(e) {
      const playButton = e.target.closest('.slot-game-card-play');
      if (playButton) {
        e.preventDefault();
        const card = playButton.closest('.slot-game-card');
        if (card) {
          const gameId = card.getAttribute('data-game-id');
          startSlotGame(gameId);
        }
      }
    });
  }

  function startSlotGame(gameId) {
    const game = slotGames.find(g => g.id === gameId);
    if (!game) return;

    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;

    currentSlotGame = game;
    if (slotGameTitle) slotGameTitle.textContent = game.name;
    
    // Simply navigate to slot-game page, just like clicking a tab
    if (window.showPage) {
      window.showPage('slot-game');
    } else {
      window.location.hash = '#slot-game';
    }
    
    // Initialize after navigation - handled by main.js onHashChange
  }

  function initializeSlotMachine(game) {
    if (!slotGameArea) return;

    // Clear any existing game
    const existingBase = document.getElementById('slotMachineBase');
    if (existingBase) {
      existingBase.remove();
    }

    // Use the complete slot integration
    if (window.SlotIntegration) {
      // Small delay to ensure page is visible
      setTimeout(() => {
        window.SlotIntegration.initialize();
      }, 150);
    }
  }

  // Spin is now handled by slot-integration.js

  // Slot machine is now handled by slot-integration.js

  // Event listeners
  if (slotBackBtn) {
    slotBackBtn.addEventListener('click', () => {
      window.location.hash = '#slots';
    });
  }

  // Spin button is handled by slot-integration.js

  if (slotBetInput) {
    slotBetInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) {
        currentBet = val;
      }
    });
  }

  // Public API
  window.Slots = {
    onShow: renderSlotsList,
    onGameShow: () => {
      if (currentSlotGame) {
        initializeSlotMachine(currentSlotGame);
      }
    }
  };

  // Initialize on load
  function initializeSlots() {
    if (slotsGrid) {
      renderSlotsList();
    } else {
      // Retry if elements aren't ready yet
      setTimeout(initializeSlots, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSlots);
  } else {
    initializeSlots();
  }
})();

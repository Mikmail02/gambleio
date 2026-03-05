/**
 * Board Games: Listing for Plinko, Roulette, etc. Same card layout and hover as Slots.
 */
(function () {
  const boardGamesGrid = document.getElementById('boardGamesGrid');
  const boardGamesSearch = document.getElementById('boardGamesSearch');

  const boardGames = [
    {
      id: 'plinko',
      name: 'Plinko',
      description: 'Drop the ball through the peg board. Land in higher multipliers for bigger wins.',
      emoji: '🎯',
      href: '#plinko'
    },
    {
      id: 'mines',
      name: 'Mines',
      description: '5×5 grid. Choose mines, click safe tiles to multiply. Hit a mine and you lose.',
      emoji: '💎',
      href: '#mines'
    },
    {
      id: 'roulette',
      name: 'Roulette',
      description: 'Classic roulette wheel. Bet on numbers, colors or ranges and spin to win.',
      emoji: '🎡',
      href: '#roulette'
    },
    {
      id: 'crash',
      name: 'Crash',
      description: 'Multiplier rises from 1.00×. Cash out before it crashes to multiply your bet.',
      emoji: '🚀',
      href: '#crash'
    },
    {
      id: 'blackjack',
      name: 'Blackjack',
      description: 'Classic 21. Hit, Stand, Double, Split, Surrender. 6-deck shoe, standard rules.',
      emoji: '🃏',
      href: '#blackjack'
    }
  ];

  function renderBoardGames(filter) {
    if (!boardGamesGrid) return;
    const q = (filter || '').trim().toLowerCase();
    const list = q
      ? boardGames.filter(g => g.name.toLowerCase().includes(q) || (g.description && g.description.toLowerCase().includes(q)))
      : boardGames;

    if (list.length === 0) {
      boardGamesGrid.innerHTML = '<p class="board-games-empty">Ingen spill funnet.</p>';
      return;
    }
    boardGamesGrid.innerHTML = list.map(game => `
      <a href="${game.href}" class="slot-game-card board-game-card" data-game-id="${game.id}">
        <div class="slot-game-card-image board-game-card-image">
          <div class="board-game-preview">${game.emoji}</div>
          <span class="slot-game-card-play">Play Game</span>
        </div>
        <div class="slot-game-card-info">
          <div class="slot-game-card-name">${game.name}</div>
          <div class="slot-game-card-description">${game.description}</div>
        </div>
      </a>
    `).join('');
  }

  function onShow() {
    renderBoardGames(boardGamesSearch ? boardGamesSearch.value : '');
  }

  if (boardGamesSearch) {
    boardGamesSearch.addEventListener('input', () => renderBoardGames(boardGamesSearch.value));
    boardGamesSearch.addEventListener('search', () => renderBoardGames(boardGamesSearch.value));
  }

  window.BoardGames = {
    onShow,
    renderBoardGames
  };
})();

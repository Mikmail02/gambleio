/**
 * Blackjack: Classic 21. Sequential deal animations, deck in corner.
 * Dealer hole card NEVER shown until flip. Hit, Double, Split, Flip animations.
 */
(function () {
  function getAuthHeaders() {
    if (typeof window.Auth !== 'undefined' && typeof window.Auth.getAuthHeaders === 'function') {
      return window.Auth.getAuthHeaders();
    }
    const token = typeof window.Auth !== 'undefined' && window.Auth.getToken ? window.Auth.getToken() : null;
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  }

  function evaluateHand(cards) {
    if (!cards || cards.length === 0) return { total: 0, bust: false, blackjack: false };
    let total = 0;
    let aces = 0;
    const cardVal = (r) => (r === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(r) ? 10 : parseInt(r, 10) || 0);
    for (const c of cards) {
      const r = typeof c === 'object' ? c.rank : c;
      if (r === 'A') aces++;
      else total += cardVal(r);
    }
    while (aces > 0) {
      if (total + 11 + (aces - 1) <= 21) {
        total += 11;
        aces--;
      } else {
        total += 1;
        aces--;
      }
    }
    const bust = total > 21;
    const blackjack = cards.length === 2 && total === 21 && cards.some((c) => (typeof c === 'object' ? c.rank : c) === 'A');
    return { total, bust, blackjack };
  }

  function canSplit(card1, card2) {
    const v = (r) => (r === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(r) ? 10 : parseInt(r, 10) || 0);
    const r1 = typeof card1 === 'object' ? card1.rank : card1;
    const r2 = typeof card2 === 'object' ? card2.rank : card2;
    return v(r1) === v(r2);
  }

  const DEAL_DELAY_MS = 900;
  const DEALER_TOTAL_PAUSE_MS = 600;

  function cardHtml(card, isBack) {
    if (isBack) {
      return '<span class="blackjack-card blackjack-card-back"></span>';
    }
    const r = card.rank || card;
    const s = card.suit || '';
    const red = s === '♥' || s === '♦';
    return `<span class="blackjack-card ${red ? 'blackjack-card-red' : ''}">${r}${s}</span>`;
  }

  let state = {
    game: null,
    balance: 0,
    renderedDealerLen: 0,
    renderedDealerHoleHidden: false,
    renderedHandLens: [],
    dealQueue: null,
    dealerRevealing: false,
  };

  function clearDealQueue() {
    if (state.dealQueue) {
      state.dealQueue.forEach((t) => clearTimeout(t));
      state.dealQueue = null;
    }
  }

  function appendCardWithAnimation(container, html, fromShoe) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const card = div.firstElementChild;
    if (card && fromShoe) {
      card.classList.add('blackjack-card-dealing');
    }
    if (card) container.appendChild(card);
  }

  function runInitialDeal(game) {
    const dealerEl = document.getElementById('blackjackDealerHand');
    const dealerTotalEl = document.getElementById('blackjackDealerTotal');
    const playerContainer = document.getElementById('blackjackPlayerHands');
    if (!dealerEl || !playerContainer) return;

    dealerEl.innerHTML = '';
    dealerTotalEl.textContent = '';
    dealerTotalEl.style.opacity = '1';
    playerContainer.innerHTML = '';

    const hands = game.hands || [];
    const dealerHand = game.dealerHand || [];
    if (dealerHand.length < 2 || !hands[0] || hands[0].cards.length < 2) return;

    const d1 = dealerHand[0];
    const d2 = dealerHand[1];
    const p1 = hands[0].cards[0];
    const p2 = hands[0].cards[1];

    const timers = [];
    let delay = 0;

    function schedule(fn, d) {
      timers.push(setTimeout(fn, d));
    }

    schedule(() => {
      appendCardWithAnimation(dealerEl, cardHtml(d1, false), true);
      dealerTotalEl.textContent = evaluateHand([d1]).total;
    }, delay);
    delay += DEAL_DELAY_MS;

    schedule(() => {
      const handDiv = document.createElement('div');
      handDiv.className = 'blackjack-player-hand blackjack-hand-active';
      handDiv.dataset.handIndex = '0';
      handDiv.innerHTML = `
        <div class="blackjack-hand-cards"></div>
        <p class="blackjack-hand-total"></p>
        <p class="blackjack-hand-bet">Bet: ${formatDollars(hands[0].bet)}</p>
      `;
      const cardsEl = handDiv.querySelector('.blackjack-hand-cards');
      const totalEl = handDiv.querySelector('.blackjack-hand-total');
      appendCardWithAnimation(cardsEl, cardHtml(p1, false), true);
      totalEl.textContent = evaluateHand([p1]).total;
      playerContainer.appendChild(handDiv);
    }, delay);
    delay += DEAL_DELAY_MS;

    schedule(() => {
      const handDiv = playerContainer.querySelector('.blackjack-player-hand');
      const cardsEl = handDiv?.querySelector('.blackjack-hand-cards');
      const totalEl = handDiv?.querySelector('.blackjack-hand-total');
      if (cardsEl && totalEl) {
        appendCardWithAnimation(cardsEl, cardHtml(p2, false), true);
        totalEl.style.opacity = '0';
        totalEl.style.transition = 'opacity 0.2s';
        setTimeout(() => {
          totalEl.textContent = evaluateHand([p1, p2]).total;
          totalEl.style.opacity = '1';
        }, 500);
      }
    }, delay);
    delay += DEAL_DELAY_MS;

    schedule(() => {
      appendCardWithAnimation(dealerEl, cardHtml(null, true), true);
      state.renderedDealerLen = 2;
      state.renderedDealerHoleHidden = true;
    }, delay);
    delay += DEAL_DELAY_MS;

    schedule(() => {
      state.dealQueue = null;
      state.renderedHandLens = hands.map((h) => h.cards.length);
      updateActionButtons(game);
    }, delay);

    state.dealQueue = timers;
  }

  function runHitAnimation(handIndex, newCard) {
    const container = document.getElementById('blackjackPlayerHands');
    const handDiv = container?.querySelector(`[data-hand-index="${handIndex}"]`);
    const cardsEl = handDiv?.querySelector('.blackjack-hand-cards');
    const totalEl = handDiv?.querySelector('.blackjack-hand-total');
    if (!cardsEl || !totalEl) return;
    appendCardWithAnimation(cardsEl, cardHtml(newCard, false), true);
    const hand = state.game?.hands?.[handIndex];
    if (hand) {
      totalEl.style.opacity = '0';
      setTimeout(() => {
        const ev = evaluateHand(hand.cards);
        totalEl.textContent = ev.bust ? 'Bust!' : ev.total;
        totalEl.style.opacity = '1';
      }, 400);
    }
    state.renderedHandLens[handIndex] = (state.renderedHandLens[handIndex] || 0) + 1;
  }

  function runSplitAnimation(game) {
    const container = document.getElementById('blackjackPlayerHands');
    if (!container) return;
    const hands = game.hands || [];
    container.innerHTML = hands.map((hand, idx) => {
      const ev = evaluateHand(hand.cards);
      const isCurrent = (game.phase === 'waiting_for_player' || game.phase === 'player_turn') && game.currentHandIndex === idx;
      const cardsHtml = hand.cards.map((c) => cardHtml(c, false)).join('');
      return `
        <div class="blackjack-player-hand blackjack-split-anim ${isCurrent ? 'blackjack-hand-active' : ''}" data-hand-index="${idx}">
          <div class="blackjack-hand-cards">${cardsHtml}</div>
          <p class="blackjack-hand-total">${ev.bust ? 'Bust!' : ev.total}</p>
          <p class="blackjack-hand-bet">Bet: ${formatDollars(hand.bet)}</p>
        </div>
      `;
    }).join('');
    state.renderedHandLens = hands.map((h) => h.cards.length);
  }

  function runDealerFlipAndDrawSequence(game, onComplete) {
    const dealerEl = document.getElementById('blackjackDealerHand');
    const dealerTotalEl = document.getElementById('blackjackDealerTotal');
    if (!dealerEl) return;
    const dealerHand = game.dealerHand || [];
    const timers = [];
    const flipDuration = 800;

    function flipHoleCard() {
      if (!state.renderedDealerHoleHidden) return;
      const holeCard = dealerHand[1];
      const cardBackEl = dealerEl.querySelector('.blackjack-card-back');
      if (cardBackEl && holeCard) {
        const r = holeCard.rank || holeCard;
        const s = holeCard.suit || '';
        const red = s === '♥' || s === '♦';
        cardBackEl.classList.remove('blackjack-card-back');
        cardBackEl.classList.add('blackjack-card-flip');
        cardBackEl.classList.toggle('blackjack-card-red', red);
        cardBackEl.textContent = r + s;
      }
      state.renderedDealerHoleHidden = false;
      state.renderedDealerLen = 2;
      const ev = evaluateHand(dealerHand.slice(0, 2));
      if (dealerTotalEl) dealerTotalEl.textContent = ev.bust ? 'Bust!' : ev.total;
    }

    function addCard(i) {
      if (i >= dealerHand.length) return;
      appendCardWithAnimation(dealerEl, cardHtml(dealerHand[i], false), true);
      state.renderedDealerLen = i + 1;
      if (dealerTotalEl) dealerTotalEl.style.opacity = '0';
      setTimeout(() => {
        const ev = evaluateHand(dealerHand.slice(0, i + 1));
        if (dealerTotalEl) {
          dealerTotalEl.textContent = ev.bust ? 'Bust!' : ev.total;
          dealerTotalEl.style.opacity = '1';
        }
      }, DEALER_TOTAL_PAUSE_MS);
    }

    if (state.renderedDealerHoleHidden) {
      timers.push(setTimeout(flipHoleCard, 0));
    }
    for (let i = 2; i < dealerHand.length; i++) {
      const delay = (state.renderedDealerHoleHidden ? flipDuration : 0) + (i - 2) * DEAL_DELAY_MS;
      timers.push(setTimeout(() => addCard(i), delay));
    }
    state.dealQueue = timers.length ? timers : null;

    if (typeof onComplete === 'function') {
      const hasFlip = state.renderedDealerHoleHidden;
      const extraCards = Math.max(0, dealerHand.length - 2);
      const totalDuration = (hasFlip ? flipDuration : 0) + extraCards * DEAL_DELAY_MS + (extraCards > 0 ? DEALER_TOTAL_PAUSE_MS : 0);
      timers.push(setTimeout(() => {
        state.dealQueue = null;
        onComplete();
      }, totalDuration));
    }
  }

  function renderDealerHand(game, hideSecond) {
    const el = document.getElementById('blackjackDealerHand');
    const totalEl = document.getElementById('blackjackDealerTotal');
    if (!el) return;
    const hand = game.dealerHand || [];

    if (hand.length === 0) {
      el.innerHTML = '';
      state.renderedDealerLen = 0;
      state.renderedDealerHoleHidden = false;
      if (totalEl) totalEl.textContent = '';
      return;
    }

    if (hideSecond && hand.length >= 2) {
      if (state.dealQueue) return;
      if (state.renderedDealerLen === 2 && state.renderedDealerHoleHidden) {
        if (totalEl) totalEl.textContent = evaluateHand([hand[0]]).total;
        return;
      }
      if (state.renderedDealerLen === 0) {
        runInitialDeal(game);
        return;
      }
      let html = cardHtml(hand[0], false);
      html += cardHtml(null, true);
      el.innerHTML = html;
      state.renderedDealerLen = 2;
      state.renderedDealerHoleHidden = true;
      if (totalEl) totalEl.textContent = evaluateHand([hand[0]]).total;
    } else {
      el.innerHTML = hand.map((c) => cardHtml(c, false)).join('');
      state.renderedDealerLen = hand.length;
      state.renderedDealerHoleHidden = false;
      if (totalEl) {
        const ev = evaluateHand(hand);
        totalEl.textContent = ev.bust ? 'Bust!' : ev.total;
      }
    }
  }

  function renderPlayerHands(game) {
    const container = document.getElementById('blackjackPlayerHands');
    if (!container) return;
    const hands = game.hands || [];
    const hideDealer = (game.phase === 'waiting_for_player' || game.phase === 'player_turn' || game.phase === 'insurance') && game.dealerHand && game.dealerHand.length >= 2;

    if (state.dealQueue && hideDealer) return;

    if (hideDealer && state.renderedDealerLen === 0) return;

    container.innerHTML = hands.map((hand, idx) => {
      const ev = evaluateHand(hand.cards);
      const isCurrent = (game.phase === 'waiting_for_player' || game.phase === 'player_turn') && game.currentHandIndex === idx;
      const cardsHtml = hand.cards.map((c) => cardHtml(c, false)).join('');
      return `
        <div class="blackjack-player-hand ${isCurrent ? 'blackjack-hand-active' : ''}" data-hand-index="${idx}">
          <div class="blackjack-hand-cards">${cardsHtml}</div>
          <p class="blackjack-hand-total">${ev.bust ? 'Bust!' : ev.total}</p>
          <p class="blackjack-hand-bet">Bet: ${formatDollars(hand.bet)}</p>
        </div>
      `;
    }).join('');
    state.renderedHandLens = hands.map((h) => h.cards.length);
  }

  function updateActionButtons(game) {
    const actionWrap = document.getElementById('blackjackActionButtons');
    const insuranceWrap = document.getElementById('blackjackInsuranceButtons');
    const betBtn = document.getElementById('blackjackBetBtn');
    const hitBtn = document.getElementById('blackjackHitBtn');
    const standBtn = document.getElementById('blackjackStandBtn');
    const doubleBtn = document.getElementById('blackjackDoubleBtn');
    const splitBtn = document.getElementById('blackjackSplitBtn');
    const surrenderBtn = document.getElementById('blackjackSurrenderBtn');
    const betInput = document.getElementById('blackjackBetAmount');

    if (!game) {
      if (actionWrap) actionWrap.classList.add('hidden');
      if (insuranceWrap) insuranceWrap.classList.add('hidden');
      if (betBtn) betBtn.disabled = false;
      return;
    }

    if (game.phase === 'insurance') {
      if (actionWrap) actionWrap.classList.add('hidden');
      if (insuranceWrap) insuranceWrap.classList.remove('hidden');
      if (betBtn) betBtn.disabled = true;
      return;
    }

    if (insuranceWrap) insuranceWrap.classList.add('hidden');

    const isPlayerTurn = game.phase === 'waiting_for_player' || game.phase === 'player_turn';
    const handIdx = game.currentHandIndex ?? 0;
    const hand = game.hands && game.hands[handIdx];
    const hasActed = game.hasActed;
    const canFirstAction = hand && hand.cards && hand.cards.length === 2 && !hasActed;
    const balance = state.balance ?? 0;

    if (isPlayerTurn && hand) {
      if (actionWrap) actionWrap.classList.remove('hidden');
      if (betBtn) betBtn.disabled = true;
      if (hitBtn) hitBtn.disabled = false;
      if (standBtn) standBtn.disabled = false;
      if (doubleBtn) {
        doubleBtn.disabled = !canFirstAction || hand.doubled || hand.splitFromAces || hand.bet > balance;
      }
      if (splitBtn) {
        splitBtn.disabled = !canFirstAction || !canSplit(hand.cards[0], hand.cards[1]) || hand.bet > balance;
      }
      if (surrenderBtn) surrenderBtn.disabled = !canFirstAction;
    } else {
      if (actionWrap) actionWrap.classList.add('hidden');
      if (betBtn) betBtn.disabled = state.dealerRevealing;
    }

    if (betInput) betInput.disabled = !!game && game.phase !== 'idle' && game.phase !== 'resolved' || state.dealerRevealing;
  }

  function flushPendingBalance() {
    if (state._pendingBalance != null) {
      if (window.Game) window.Game.balance = state._pendingBalance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      state._pendingBalance = null;
    }
  }

  function showResult(game) {
    const el = document.getElementById('blackjackResult');
    if (!el || !game) return;
    if (game.phase !== 'resolved') {
      el.textContent = '';
      el.className = 'blackjack-result';
      return;
    }
    // totalNet = total returned to player (bet was pre-deducted)
    const totalReturn = game.totalNet;
    const totalBet = (game.hands || []).reduce((s, h) => s + h.bet, 0);
    const profit = totalReturn - totalBet;
    if (profit > 0) {
      el.textContent = 'Won ' + formatDollars(totalReturn) + '!';
      el.className = 'blackjack-result blackjack-result-win';
    } else if (totalReturn < totalBet) {
      const loss = totalBet - totalReturn;
      el.textContent = '-' + formatDollars(loss) + ' Loss';
      el.className = 'blackjack-result blackjack-result-loss';
    } else {
      el.textContent = 'Push';
      el.className = 'blackjack-result blackjack-result-push';
    }
  }

  function render(game) {
    if (!game) {
      clearDealQueue();
      state.renderedDealerLen = 0;
      state.renderedDealerHoleHidden = false;
      state.renderedHandLens = [];
      renderDealerHand({ dealerHand: [] }, false);
      renderPlayerHands({ hands: [] });
      updateActionButtons(null);
      showResult(null);
      return;
    }

    const hideDealer = (game.phase === 'waiting_for_player' || game.phase === 'player_turn' || game.phase === 'insurance') && game.dealerHand && game.dealerHand.length >= 2;
    const prevGame = state._prevGame;
    state._prevGame = JSON.stringify({ phase: game.phase, dealerLen: game.dealerHand?.length, handLens: game.hands?.map((h) => h.cards.length) });

    if (game.phase === 'idle') {
      clearDealQueue();
      state.renderedDealerLen = 0;
      state.renderedDealerHoleHidden = false;
      state.renderedHandLens = [];
    }

    if (game.phase === 'dealing' || game.phase === 'insurance') {
      state.renderedDealerLen = 0;
      state.renderedDealerHoleHidden = false;
      state.renderedHandLens = [];
    }

    if (game.phase === 'dealer_turn' || game.phase === 'resolved') {
      const dealerHand = game.dealerHand || [];
      const needsFlip = state.renderedDealerHoleHidden && dealerHand.length >= 2;
      const needsMoreCards = state.renderedDealerLen < dealerHand.length;
      if (needsFlip || needsMoreCards) {
        state.dealerRevealing = true;
        runDealerFlipAndDrawSequence(game, () => {
          state.dealerRevealing = false;
          state.renderedDealerHoleHidden = false;
          state.renderedDealerLen = dealerHand.length;
          updateActionButtons(game);
          showResult(game);
          flushPendingBalance();
        });
        renderPlayerHands(game);
        updateActionButtons(game);
        return;
      }
    }

    const hands = game.hands || [];
    const prevLens = state.renderedHandLens || [];

    if (game.phase === 'waiting_for_player' || game.phase === 'player_turn') {
      if (prevGame) {
        const prev = JSON.parse(prevGame);
        for (let hi = 0; hi < hands.length; hi++) {
          const prevLen = prev.handLens?.[hi] || 0;
          const currLen = hands[hi].cards.length;
          if (currLen > prevLen && currLen - prevLen === 1) {
            runHitAnimation(hi, hands[hi].cards[currLen - 1]);
            renderDealerHand(game, hideDealer);
            updateActionButtons(game);
            showResult(game);
            return;
          }
        }
        if (prev.handLens?.length === 1 && hands.length === 2) {
          runSplitAnimation(game);
          renderDealerHand(game, hideDealer);
          updateActionButtons(game);
          showResult(game);
          return;
        }
      }
    }

    if (state.dealQueue && hideDealer) {
      renderDealerHand(game, hideDealer);
      return;
    }

    renderDealerHand(game, hideDealer);
    renderPlayerHands(game);
    updateActionButtons(game);
    showResult(game);
    if (game && game.phase === 'resolved') flushPendingBalance();
  }

  async function fetchState() {
    try {
      const res = await fetch('/api/blackjack/state', { headers: getAuthHeaders() });
      const data = await res.json();
      state.balance = data.balance ?? 0;
      state.game = data.game;
      if (window.Game) window.Game.balance = state.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      state._prevGame = null;
      render(state.game);
      return data;
    } catch (e) {
      console.error('Blackjack fetchState:', e);
      return null;
    }
  }

  async function placeBet() {
    const betInput = document.getElementById('blackjackBetAmount');
    const amount = parseFloat(betInput?.value) || 10;
    if (!window.Auth || !window.Auth.requireAuth(() => {})) return;
    if (window.Auth.getCurrentUser && !window.Auth.getCurrentUser()) return;
    const balance = window.Game ? (window.Game.getBalance ? window.Game.getBalance() : window.Game.balance) : 0;
    if (amount > balance) {
      if (window.showGambleLockToast) window.showGambleLockToast('Insufficient balance');
      else alert('Insufficient balance');
      return;
    }
    try {
      const res = await fetch('/api/blackjack/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (data.error) {
        if (data.code === 'GAMBLE_LOCKED' && window.showGambleLockToast) window.showGambleLockToast(data.error);
        else alert(data.error || 'Bet failed');
        return;
      }
      state.balance = data.balance;
      state.game = data.game;
      state._prevGame = null;
      clearDealQueue();
      state.renderedDealerLen = 0;
      state.renderedDealerHoleHidden = false;
      state.renderedHandLens = [];
      const dealerEl = document.getElementById('blackjackDealerHand');
      const dealerTotalEl = document.getElementById('blackjackDealerTotal');
      const playerContainer = document.getElementById('blackjackPlayerHands');
      if (dealerEl) dealerEl.innerHTML = '';
      if (dealerTotalEl) dealerTotalEl.textContent = '';
      if (playerContainer) playerContainer.innerHTML = '';
      const resultEl = document.getElementById('blackjackResult');
      if (resultEl) { resultEl.textContent = ''; resultEl.className = 'blackjack-result'; }
      if (window.Game) window.Game.balance = state.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      if (window.LiveStats) window.LiveStats.recordBetPlaced('blackjack', amount);
      render(state.game);
    } catch (e) {
      console.error('Blackjack bet:', e);
      alert('Bet failed');
    }
  }

  async function doAction(action, handIndex) {
    if (!state.game) return;
    const prevGame = JSON.stringify({
      phase: state.game.phase,
      dealerLen: state.game.dealerHand?.length,
      handLens: state.game.hands?.map((h) => h.cards.length),
    });
    try {
      const res = await fetch('/api/blackjack/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ action, handIndex: handIndex ?? 0 }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error || 'Action failed');
        return;
      }
      state.balance = data.balance;
      state.game = data.game;
      state._prevGame = prevGame;
      // Defer balance UI update — will be applied when result text appears
      state._pendingBalance = data.balance;
      if (state.game && state.game.phase === 'resolved') {
        const totalBet = state.game.hands.reduce((s, h) => s + h.bet, 0);
        const profit = state.game.totalNet - totalBet;
        if (profit > 0) {
          if (window.LiveStats) window.LiveStats.recordRound('blackjack', totalBet, state.game.totalNet);
          if (window.Stats && window.Stats.win) {
            await window.Stats.win(state.game.totalNet, 1, totalBet, 'blackjack');
          }
        }
      }
      render(state.game);
    } catch (e) {
      console.error('Blackjack action:', e);
      alert('Action failed');
    }
  }

  async function doInsurance(amount) {
    if (!state.game || state.game.phase !== 'insurance') return;
    try {
      const res = await fetch('/api/blackjack/insurance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      state.balance = data.balance;
      state.game = data.game;
      if (window.Game) window.Game.balance = state.balance;
      if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
      render(state.game);
    } catch (e) {
      console.error('Blackjack insurance:', e);
    }
  }

  async function doNoInsurance() {
    if (!state.game || state.game.phase !== 'insurance') return;
    try {
      const res = await fetch('/api/blackjack/no-insurance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.error) return;
      state.balance = data.balance;
      state.game = data.game;
      if (window.Game) window.Game.balance = state.balance;
      render(state.game);
    } catch (e) {
      console.error('Blackjack no-insurance:', e);
    }
  }

  function bindUi() {
    const betBtn = document.getElementById('blackjackBetBtn');
    const hitBtn = document.getElementById('blackjackHitBtn');
    const standBtn = document.getElementById('blackjackStandBtn');
    const doubleBtn = document.getElementById('blackjackDoubleBtn');
    const splitBtn = document.getElementById('blackjackSplitBtn');
    const surrenderBtn = document.getElementById('blackjackSurrenderBtn');
    const insuranceBtn = document.getElementById('blackjackInsuranceBtn');
    const noInsuranceBtn = document.getElementById('blackjackNoInsuranceBtn');
    const betInput = document.getElementById('blackjackBetAmount');
    const betHalf = document.getElementById('blackjackBetHalf');
    const betDouble = document.getElementById('blackjackBetDouble');

    if (betBtn) betBtn.addEventListener('click', placeBet);
    if (hitBtn) hitBtn.addEventListener('click', () => doAction('hit', state.game?.currentHandIndex ?? 0));
    if (standBtn) standBtn.addEventListener('click', () => doAction('stand', state.game?.currentHandIndex ?? 0));
    if (doubleBtn) doubleBtn.addEventListener('click', () => doAction('double', state.game?.currentHandIndex ?? 0));
    if (splitBtn) splitBtn.addEventListener('click', () => doAction('split', state.game?.currentHandIndex ?? 0));
    if (surrenderBtn) surrenderBtn.addEventListener('click', () => doAction('surrender', state.game?.currentHandIndex ?? 0));
    if (insuranceBtn) {
      insuranceBtn.addEventListener('click', () => {
        const hand = state.game?.hands?.[0];
        const amt = hand ? hand.bet / 2 : 0;
        doInsurance(amt);
      });
    }
    if (noInsuranceBtn) noInsuranceBtn.addEventListener('click', doNoInsurance);

    if (betHalf && betInput) {
      betHalf.addEventListener('click', () => {
        const v = parseFloat(betInput.value) || 10;
        betInput.value = Math.max(0.5, v / 2);
      });
    }
    if (betDouble && betInput) {
      betDouble.addEventListener('click', () => {
        const v = parseFloat(betInput.value) || 10;
        betInput.value = v * 2;
      });
    }
  }

  function onShow() {
    state.balance = window.Game ? (window.Game.getBalance ? window.Game.getBalance() : window.Game.balance) : 0;
    fetchState();
  }

  bindUi();

  window.Blackjack = {
    onShow,
    fetchState,
    getState: () => state,
  };
})();

/**
 * Blackjack core logic: deck, hand evaluation, provably fair shuffle.
 * Standard American/European rules. 6-deck shoe (312 cards).
 * Used by server.js for authoritative game state.
 */
'use strict';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const DECK_SIZE = 52;
const SHOE_DECKS = 6;
const SHOE_SIZE = DECK_SIZE * SHOE_DECKS;

/** Card value for counting: 2-10 = face, J/Q/K = 10, A = 1 or 11 */
function cardValue(rank) {
  if (rank === 'A') return 11; // soft value; caller handles hard
  if (['J', 'Q', 'K', '10'].includes(rank)) return 10;
  return parseInt(rank, 10) || 0;
}

/**
 * Evaluate hand total. Returns { total, soft, bust, blackjack }.
 * - total: best value ≤21, or lowest bust value
 * - soft: true if hand contains usable Ace (counted as 11)
 * - bust: true if total > 21
 * - blackjack: true only for natural 21 on exactly 2 cards (A + 10-value)
 */
function evaluateHand(cards) {
  if (!cards || cards.length === 0) return { total: 0, soft: false, bust: false, blackjack: false };
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = typeof c === 'string' ? c : (c.rank || c);
    if (r === 'A') aces++;
    else total += cardValue(r);
  }
  // Add aces: first as 11, rest as 1
  while (aces > 0) {
    if (total + 11 + (aces - 1) <= 21) {
      total += 11;
      aces--;
    } else {
      total += 1;
      aces--;
    }
  }
  const soft = total <= 21 && cards.some((c) => (typeof c === 'string' ? c : c.rank) === 'A');
  const bust = total > 21;
  const blackjack = cards.length === 2 && total === 21 && cards.some((c) => (typeof c === 'string' ? c : c.rank) === 'A');
  return { total, soft, bust, blackjack };
}

/** Check if two cards have same value for split (e.g. 8-8, K-Q) */
function canSplit(card1, card2) {
  const r1 = typeof card1 === 'string' ? card1 : (card1.rank || card1);
  const r2 = typeof card2 === 'string' ? card2 : (card2.rank || card2);
  const v1 = cardValue(r1);
  const v2 = cardValue(r2);
  return v1 === v2;
}

/** Check if hand is pair of Aces (special split rules) */
function isPairOfAces(cards) {
  if (!cards || cards.length !== 2) return false;
  const r1 = typeof cards[0] === 'string' ? cards[0] : (cards[0].rank || cards[0]);
  const r2 = typeof cards[1] === 'string' ? cards[1] : (cards[1].rank || cards[1]);
  return r1 === 'A' && r2 === 'A';
}

/** Create a single shuffled deck (52 cards) as [rank, suit] pairs */
function createDeck() {
  const deck = [];
  for (const R of RANKS) {
    for (const S of SUITS) {
      deck.push({ rank: R, suit: S });
    }
  }
  return deck;
}

/** Create full shoe: 6 decks */
function createShoe() {
  const shoe = [];
  for (let i = 0; i < SHOE_DECKS; i++) {
    shoe.push(...createDeck());
  }
  return shoe;
}

/**
 * Provably fair Fisher-Yates shuffle: deterministic from serverSeed + clientSeed.
 * Returns shuffled array (mutates copy, not original).
 */
function seededShuffle(deck, serverSeed, clientSeed) {
  const arr = deck.map((c) => ({ ...c }));
  const combined = String(serverSeed || '') + String(clientSeed || '');
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const c = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash = hash & hash;
  }
  // Simple seeded PRNG: hash-based
  const seed = (hash >>> 0) || 1;
  let s = seed;
  function next() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Shuffle shoe with provably fair seeds */
function shuffleShoe(serverSeed, clientSeed) {
  const shoe = createShoe();
  return seededShuffle(shoe, serverSeed, clientSeed);
}

// State machine phases
const PHASE = {
  IDLE: 'idle',
  BETTING: 'betting',
  DEALING: 'dealing',
  INSURANCE: 'insurance',
  WAITING_FOR_PLAYER: 'waiting_for_player',
  PLAYER_TURN: 'player_turn',
  DEALER_TURN: 'dealer_turn',
  RESOLVED: 'resolved',
};

// Player actions
const ACTION = {
  HIT: 'hit',
  STAND: 'stand',
  DOUBLE: 'double',
  SPLIT: 'split',
  SURRENDER: 'surrender',
  INSURANCE: 'insurance',
  NO_INSURANCE: 'no_insurance',
};

// Dealer config: hit on soft 17 or stand on all 17s
const DEALER_HIT_SOFT_17 = true;

module.exports = {
  RANKS,
  SUITS,
  DECK_SIZE,
  SHOE_DECKS,
  SHOE_SIZE,
  PHASE,
  ACTION,
  DEALER_HIT_SOFT_17,
  cardValue,
  evaluateHand,
  canSplit,
  isPairOfAces,
  createDeck,
  createShoe,
  seededShuffle,
  shuffleShoe,
};

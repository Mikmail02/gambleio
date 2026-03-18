/**
 * Golden Shower Slot Engine  – Plain-JS build (no compile step needed)
 * This file is a direct translation of engine.ts for immediate use in server.js.
 *
 * Grid layout: grid[col][row], 6 cols × 5 rows.
 * All payouts are expressed in bet-units (multiply by bet to get credits).
 */

'use strict';

// ─────────────────────────────────────────
// Constants
// ─────────────────────────────────────────

const COLS = 6;
const ROWS = 5;
const MAX_MULTIPLIER = 999;

/** Paying symbols ordered highest → lowest value */
const PAYING_SYMBOLS = ['SOAP', 'DUCK', 'SPONGE', 'TOILET_PAPER', 'GREEN_PILL', 'BRUSH', 'SHAMPOO'];

/**
 * Payout as bet-unit multipliers, verified against official pay-table screenshots.
 * Example: SOAP 14+ = 6× bet  →  at 0.20 bet → 1.20 payout  ✓
 */
const PAYOUT_TABLE = {
  SOAP:         { '6-8': 0.30, '9-11': 1.00, '12-13': 2.50, '14+': 6.00 },
  DUCK:         { '6-8': 0.20, '9-11': 0.50, '12-13': 1.50, '14+': 4.00 },
  SPONGE:       { '6-8': 0.20, '9-11': 0.50, '12-13': 1.00, '14+': 3.00 },
  TOILET_PAPER: { '6-8': 0.15, '9-11': 0.30, '12-13': 0.80, '14+': 2.50 },
  GREEN_PILL:   { '6-8': 0.15, '9-11': 0.30, '12-13': 0.70, '14+': 2.00 },
  BRUSH:        { '6-8': 0.10, '9-11': 0.20, '12-13': 0.60, '14+': 1.50 },
  SHAMPOO:      { '6-8': 0.10, '9-11': 0.20, '12-13': 0.50, '14+': 1.00 },
};

/**
 * Symbol spawn weights — tune these to adjust RTP and volatility.
 * Higher number = appears more often in each cell.
 *
 * ⚠  RTP CALIBRATION NOTE
 * In a 6×5 = 30-cell grid:
 *   P(symbol appears at least once) ≈ 1 - (1 - w/total)^30
 *
 * With the values below:
 *   WILD    ≈  8 %   chance per grid
 *   STEAM   ≈  6 %
 *   BONUS   ≈  7 %   (need 3 to trigger Gold Spins)
 *   FLOATER ≈  5 %   (Fallback B when no wins/wilds)
 *   DRAIN   ≈  3 %   (Fallback C when no wins/wilds/floater)
 *
 * Run  simulateRtp(1_000_000)  to measure RTP, then adjust until
 * the target ~96 % house RTP is reached.
 */
const SYMBOL_WEIGHTS = {
  // Paying symbols — must dominate the pool to keep specials rare
  SHAMPOO:      1000,
  BRUSH:         800,
  GREEN_PILL:    700,
  TOILET_PAPER:  600,
  SPONGE:        500,
  DUCK:          400,
  SOAP:          200,
  // Special — raise/lower to tune RTP and feature frequency
  WILD:           22,
  BONUS:          20,
  STEAM:          18,
  FLOATER:        14,
  DRAIN:          10,
};

const SYMBOL_ENTRIES = Object.entries(SYMBOL_WEIGHTS);
const TOTAL_WEIGHT = SYMBOL_ENTRIES.reduce((s, [, w]) => s + w, 0);

// ─────────────────────────────────────────
// Feature Modes (Bonus Buys & Boosters)
// ─────────────────────────────────────────

/**
 * Cost multipliers verified against official screenshots at both $0.20 and $400 base bet.
 *
 * Mystery Bonus probabilities: 30% → 3 BONUS, 40% → 4 BONUS, 30% → 5 BONUS
 *   EV = 0.30×90 + 0.40×200 + 0.30×500 = 257× (matches cost exactly)
 */
const FEATURE_MODES = {
  // ── Bonus Buys ──────────────────────────────────────────────
  BONUS_3: {
    label: '6 Gold Spins',
    description: 'Guaranteed 3 BONUS symbols — triggers 6 Gold Spins',
    costMultiplier: 90,
    guaranteedBonusCount: 3,
    section: 'bonus',
  },
  BONUS_4: {
    label: '8 Gold Spins',
    description: 'Guaranteed 4 BONUS symbols — triggers 8 Gold Spins',
    costMultiplier: 200,
    guaranteedBonusCount: 4,
    section: 'bonus',
  },
  BONUS_5: {
    label: '10 Gold Spins',
    description: 'Guaranteed 5 BONUS symbols — triggers 10 Gold Spins',
    costMultiplier: 500,
    guaranteedBonusCount: 5,
    section: 'bonus',
  },
  MYSTERY_BONUS: {
    label: 'Lucky Draw',
    description: '30% chance of 6, 40% chance of 8, or 30% chance of 10 Gold Spins',
    costMultiplier: 257,
    mysteryBonus: true,
    section: 'bonus',
  },
  // ── Nolimit Boosters ────────────────────────────────────────
  BONUS_HUNT: {
    label: 'Bonus Hunt',
    description: '3× more likely to trigger Gold Spins naturally (2× bet)',
    costMultiplier: 2,
    bonusHuntMultiplier: 3,
    section: 'booster',
  },
  STEAMY_SPIN: {
    label: 'Steamy Spin',
    description: 'All position multipliers start at ×16',
    costMultiplier: 20,
    initialMultiplier: 16,
    section: 'booster',
  },
  STEAMIER_SPIN: {
    label: 'Steamier Spin',
    description: 'All position multipliers start at ×64',
    costMultiplier: 80,
    initialMultiplier: 64,
    section: 'booster',
  },
  STEAMIEST_SPIN: {
    label: 'Steamiest Spin',
    description: 'All positions start at ×128. Guaranteed DRAIN — its position updates to ×999 when triggered',
    costMultiplier: 1969,
    initialMultiplier: 128,
    guaranteedDrain: true,
    drainCellToMax: true,
    section: 'booster',
  },
};

// ─────────────────────────────────────────
// RNG (pluggable for provably fair)
// ─────────────────────────────────────────

let _rng = Math.random;

function setRng(fn) { _rng = fn; }

function rng() { return _rng(); }

function weightedPick(entries, total) {
  let r = rng() * total;
  for (const [sym, w] of entries) {
    r -= w;
    if (r <= 0) return sym;
  }
  return entries[entries.length - 1][0];
}

function pickFrom(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function generateSymbol() {
  return weightedPick(SYMBOL_ENTRIES, TOTAL_WEIGHT);
}

// ─────────────────────────────────────────
// Grid utilities
// ─────────────────────────────────────────

function createFreshGrid() {
  return Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => ({
      symbol: generateSymbol(),
      multiplier: 1,
    }))
  );
}

function cloneGrid(grid) {
  return grid.map(col => col.map(cell => ({ ...cell })));
}

/**
 * Create a bonus-spin starting grid: fresh random symbols, but PRESERVED
 * position multipliers. This fixes the identical-grid-per-bonus-spin bug
 * where cloneGrid() was reusing the same symbol layout every spin.
 */
function createBonusSpinGrid(currentGrid) {
  return Array.from({ length: COLS }, (_, col) =>
    Array.from({ length: ROWS }, (_, row) => ({
      symbol: generateSymbol(),
      multiplier: currentGrid[col][row].multiplier, // keep hard-earned multipliers
    }))
  );
}

/**
 * Build a starting grid for a feature buy / booster spin.
 * Returns { startGrid, spinOptions } — spinOptions is forwarded to resolveSpin.
 */
function createFeatureGrid(featureModeKey) {
  const mode = FEATURE_MODES[featureModeKey];
  if (!mode) return { startGrid: createFreshGrid(), spinOptions: {} };

  const initialMult = mode.initialMultiplier || 1;

  // Adjust symbol weights for Bonus Hunt (3× BONUS weight)
  let entries = SYMBOL_ENTRIES;
  let total = TOTAL_WEIGHT;
  if (mode.bonusHuntMultiplier) {
    entries = SYMBOL_ENTRIES.map(([s, w]) => [s, s === 'BONUS' ? w * mode.bonusHuntMultiplier : w]);
    total = entries.reduce((s, [, w]) => s + w, 0);
  }

  // Build grid with chosen multiplier and weights
  const grid = Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => ({
      symbol: weightedPick(entries, total),
      multiplier: initialMult,
    }))
  );

  // ── Resolve guaranteed BONUS count (or mystery) ───────────
  let bonusCount = mode.guaranteedBonusCount || 0;
  if (mode.mysteryBonus) {
    const r = rng();
    bonusCount = r < 0.30 ? 3 : r < 0.70 ? 4 : 5;
  }

  if (bonusCount > 0) {
    // Remove any naturally-spawned BONUS so total stays exact
    const noBonus = SYMBOL_ENTRIES.filter(([s]) => s !== 'BONUS');
    const noBonusTotal = noBonus.reduce((s, [, w]) => s + w, 0);
    for (let col = 0; col < COLS; col++)
      for (let row = 0; row < ROWS; row++)
        if (grid[col][row].symbol === 'BONUS')
          grid[col][row].symbol = weightedPick(noBonus, noBonusTotal);

    // Shuffle all positions and place exactly N BONUS symbols
    const positions = [];
    for (let col = 0; col < COLS; col++)
      for (let row = 0; row < ROWS; row++)
        positions.push([col, row]);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    for (let i = 0; i < bonusCount; i++) {
      const [col, row] = positions[i];
      grid[col][row].symbol = 'BONUS';
    }
  }

  // ── Steamiest Spin: guaranteed DRAIN ──────────────────────
  if (mode.guaranteedDrain) {
    const candidates = [];
    for (let col = 0; col < COLS; col++)
      for (let row = 0; row < ROWS; row++)
        if (grid[col][row].symbol !== 'BONUS') candidates.push([col, row]);
    // Prefer placing DRAIN where one doesn't already exist
    const noDrain = candidates.filter(([c, r]) => grid[c][r].symbol !== 'DRAIN');
    const target = noDrain.length > 0 ? noDrain : candidates;
    const [col, row] = target[Math.floor(rng() * target.length)];
    grid[col][row].symbol = 'DRAIN';
  }

  return {
    startGrid: grid,
    spinOptions: { drainCellToMax: !!mode.drainCellToMax },
  };
}

function boostMultiplier(current) {
  if (current < 2) return 2;
  return Math.min(current * 2, MAX_MULTIPLIER);
}

/**
 * Gravity / cascade:
 * Only SYMBOLS fall to the bottom of each column — the multiplier belongs
 * to the grid position (cell), not the symbol, so it must never move.
 * Empty slots at the top receive freshly generated symbols.
 * Each cell's multiplier is left completely untouched.
 */
function fillNulls(grid) {
  const g = cloneGrid(grid);
  for (let col = 0; col < COLS; col++) {
    // Collect the symbols still present (preserving top→bottom order)
    const symbols = g[col]
      .filter(c => c.symbol !== null)
      .map(c => c.symbol);
    const missing = ROWS - symbols.length;
    // New symbols enter from the top
    const newSymbols = Array.from({ length: missing }, () => generateSymbol());
    const allSymbols = [...newSymbols, ...symbols];
    // Write only the symbol field — multipliers stay at their positions
    for (let row = 0; row < ROWS; row++) {
      g[col][row].symbol = allSymbols[row];
    }
  }
  return g;
}

// ─────────────────────────────────────────
// Cluster detection (BFS)
// ─────────────────────────────────────────

function getBasePayout(sym, count) {
  const t = PAYOUT_TABLE[sym];
  if (!t) return 0;
  if (count >= 14) return t['14+'];
  if (count >= 12) return t['12-13'];
  if (count >= 9)  return t['9-11'];
  return t['6-8'];
}

/**
 * Finds all winning clusters (6+ connected cells of the same paying symbol).
 * WILDs extend clusters but don't seed their own.
 */
function detectClusters(grid) {
  const visited = Array.from({ length: COLS }, () => new Array(ROWS).fill(false));
  const clusters = [];

  function bfs(startCol, startRow, symType) {
    const cells = [];
    const queue = [[startCol, startRow]];
    visited[startCol][startRow] = true;
    while (queue.length > 0) {
      const [c, r] = queue.shift();
      cells.push([c, r]);
      const neighbours = [[c-1,r],[c+1,r],[c,r-1],[c,r+1]];
      for (const [nc, nr] of neighbours) {
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        if (visited[nc][nr]) continue;
        const s = grid[nc][nr].symbol;
        if (s === symType || s === 'WILD') {
          visited[nc][nr] = true;
          queue.push([nc, nr]);
        }
      }
    }
    return cells;
  }

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (visited[col][row]) continue;
      const sym = grid[col][row].symbol;
      if (!sym || !PAYING_SYMBOLS.includes(sym)) continue;
      const cells = bfs(col, row, sym);
      if (cells.length < 6) continue;
      const base = getBasePayout(sym, cells.length);
      const cellMultSum = cells.reduce((sum, [c, r]) => sum + grid[c][r].multiplier, 0);
      clusters.push({
        symbolType: sym,
        cells,
        baseMultiplier: base,
        cellMultiplierSum: cellMultSum,
        totalMultiplier: base * cellMultSum,
      });
    }
  }

  return clusters;
}

// ─────────────────────────────────────────
// Grid mutations
// ─────────────────────────────────────────

function destroyClusterCells(grid, cells) {
  const g = cloneGrid(grid);
  for (const [col, row] of cells) {
    g[col][row].symbol = null;
    g[col][row].multiplier = boostMultiplier(g[col][row].multiplier);
  }
  return g;
}

/** Convert off-cluster cells that share the cluster's symbol type into WILD. */
function applyWildGeneration(grid, clusters) {
  const g = cloneGrid(grid);
  for (const cluster of clusters) {
    const inCluster = new Set(cluster.cells.map(([c, r]) => `${c},${r}`));
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        if (inCluster.has(`${col},${row}`)) continue;
        if (g[col][row].symbol === cluster.symbolType) {
          g[col][row].symbol = 'WILD';
        }
      }
    }
  }
  return g;
}

// ─────────────────────────────────────────
// Special mechanics
// ─────────────────────────────────────────

/** STEAM: upgrade a random paying symbol type (and the STEAM itself) to the next tier. */
function resolveSteam(grid) {
  const steamCells = [];
  const present = new Set();
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = grid[col][row].symbol;
      if (s === 'STEAM') steamCells.push([col, row]);
      if (s && PAYING_SYMBOLS.includes(s)) present.add(s);
    }
  }
  if (steamCells.length === 0) return null;

  // candidates = symbols that can be upgraded (everything except SOAP at index 0)
  const candidates = PAYING_SYMBOLS.filter(s => present.has(s) && PAYING_SYMBOLS.indexOf(s) > 0);
  const g = cloneGrid(grid);

  if (candidates.length === 0) {
    for (const [col, row] of steamCells) g[col][row].symbol = null;
    return null;
  }

  const from = pickFrom(candidates);
  const to = PAYING_SYMBOLS[PAYING_SYMBOLS.indexOf(from) - 1];

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = g[col][row].symbol;
      if (s === from || s === 'STEAM') g[col][row].symbol = to;
    }
  }
  return { grid: g, from, to };
}

/** WILD BURST: wilds explode + destroy 4-directional neighbours (not BONUS). */
function resolveWildBurst(grid) {
  const wilds = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[col][row].symbol === 'WILD') wilds.push([col, row]);
    }
  }
  if (wilds.length === 0) return null;

  const toDestroy = new Set();
  for (const [col, row] of wilds) {
    toDestroy.add(`${col},${row}`);
    for (const [nc, nr] of [[col-1,row],[col+1,row],[col,row-1],[col,row+1]]) {
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      if (grid[nc][nr].symbol === 'BONUS') continue;
      toDestroy.add(`${nc},${nr}`);
    }
  }

  const g = cloneGrid(grid);
  const destroyedCells = [];
  for (const key of toDestroy) {
    const [col, row] = key.split(',').map(Number);
    g[col][row].symbol = null;
    g[col][row].multiplier = boostMultiplier(g[col][row].multiplier);
    destroyedCells.push([col, row]);
  }
  return { grid: g, destroyedCells };
}

/** FLOATER: keep one paying symbol, remove everything else (except BONUS and DRAIN). */
function resolveFloater(grid) {
  let floaterFound = false;
  const present = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = grid[col][row].symbol;
      if (s === 'FLOATER') floaterFound = true;
      if (s && PAYING_SYMBOLS.includes(s) && !present.includes(s)) present.push(s);
    }
  }
  if (!floaterFound || present.length === 0) return null;

  const chosen = pickFrom(present);
  const g = cloneGrid(grid);
  const affectedCells = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = g[col][row].symbol;
      if (s === null || s === chosen || s === 'BONUS' || s === 'DRAIN') continue;
      g[col][row].symbol = null;
      g[col][row].multiplier = boostMultiplier(g[col][row].multiplier);
      affectedCells.push([col, row]);
    }
  }
  return { grid: g, chosenSymbol: chosen, affectedCells };
}

/**
 * DRAIN: remove all non-BONUS symbols, double every cleared cell's multiplier.
 * @param {boolean} drainCellToMax  Steamiest Spin only: the cell that contained
 *                                  DRAIN is set to ×999 instead of the normal ×2.
 */
function resolveDrain(grid, drainCellToMax = false) {
  let drainFound = false;
  for (let col = 0; col < COLS && !drainFound; col++) {
    for (let row = 0; row < ROWS && !drainFound; row++) {
      if (grid[col][row].symbol === 'DRAIN') drainFound = true;
    }
  }
  if (!drainFound) return null;

  const g = cloneGrid(grid);
  const affectedCells = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = g[col][row].symbol;
      if (s === null || s === 'BONUS') continue;
      g[col][row].symbol = null;
      if (drainCellToMax && s === 'DRAIN') {
        g[col][row].multiplier = MAX_MULTIPLIER; // Steamiest Spin: DRAIN cell → ×999
      } else {
        g[col][row].multiplier = boostMultiplier(g[col][row].multiplier);
      }
      affectedCells.push([col, row]);
    }
  }
  return { grid: g, affectedCells };
}

// ─────────────────────────────────────────
// Bonus detection
// ─────────────────────────────────────────

function countBonus(grid) {
  let n = 0;
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[col][row].symbol === 'BONUS') n++;
    }
  }
  return n;
}

function bonusSpinsFor(count) {
  if (count >= 5) return 10;
  if (count === 4) return 8;
  if (count >= 3) return 6;
  return 0;
}

// ─────────────────────────────────────────
// Core spin resolver
// ─────────────────────────────────────────

/**
 * Resolves a single spin to completion.
 *
 * Resolution order:
 *   1. STEAM  → convert + cascade → loop
 *   2. WIN    → payout + wild-gen + destroy + cascade → loop
 *   3a. WILD BURST → destroy + cascade → loop
 *   3b. FLOATER   → clear + cascade → loop
 *   3c. DRAIN     → clear + cascade → loop
 *   4. Done
 *
 * @param {object[][]} initialGrid
 * @param {boolean}    isBonus       – multipliers persist during Gold Spins
 * @param {object}     spinOptions   – feature-mode options, e.g. { drainCellToMax }
 * @returns {{ totalPayout, steps, bonusTriggered, bonusSpinsAwarded, finalGrid }}
 */
function resolveSpin(initialGrid, isBonus = false, spinOptions = {}) {
  let grid = cloneGrid(initialGrid);
  const steps = [];
  let totalPayout = 0;
  const MAX_ITER = 200;
  let iter = 0;

  while (iter++ < MAX_ITER) {
    // 1. STEAM
    const steam = resolveSteam(grid);
    if (steam) {
      grid = steam.grid;
      steps.push({ type: 'STEAM_CONVERSION', grid: cloneGrid(grid), payout: 0, steamFrom: steam.from, steamTo: steam.to });
      if (grid.some(col => col.some(c => c.symbol === null))) {
        grid = fillNulls(grid);
        steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      }
      continue;
    }

    // 2. WIN
    const clusters = detectClusters(grid);
    if (clusters.length > 0) {
      grid = applyWildGeneration(grid, clusters);
      const stepPayout = clusters.reduce((s, c) => s + c.totalMultiplier, 0);
      totalPayout += stepPayout;
      const allCells = clusters.flatMap(c => c.cells);
      grid = destroyClusterCells(grid, allCells);
      steps.push({ type: 'WIN', grid: cloneGrid(grid), payout: stepPayout, clusters });
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // 3a. WILD BURST
    const wildBurst = resolveWildBurst(grid);
    if (wildBurst) {
      grid = wildBurst.grid;
      steps.push({ type: 'WILD_BURST', grid: cloneGrid(grid), payout: 0, wildBurstCells: wildBurst.destroyedCells });
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // 3b. FLOATER
    const floater = resolveFloater(grid);
    if (floater) {
      grid = floater.grid;
      steps.push({ type: 'FLOATER_ACTIVATION', grid: cloneGrid(grid), payout: 0, floaterSymbol: floater.chosenSymbol });
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // 3c. DRAIN
    const drain = resolveDrain(grid, spinOptions.drainCellToMax || false);
    if (drain) {
      grid = drain.grid;
      steps.push({ type: 'DRAIN_ACTIVATION', grid: cloneGrid(grid), payout: 0, drainCells: drain.affectedCells });
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // 4. Spin over
    break;
  }

  const bonusCount = countBonus(grid);
  const bonusSpinsAwarded = bonusSpinsFor(bonusCount);

  return { totalPayout, steps, bonusTriggered: bonusSpinsAwarded > 0, bonusSpinsAwarded, finalGrid: grid };
}

// ─────────────────────────────────────────
// Session management
// ─────────────────────────────────────────

function createInitialGameState() {
  return {
    grid: createFreshGrid(),
    bonusState: { active: false, spinsRemaining: 0, totalSpins: 0 },
    lastSpinPayout: 0,
  };
}

/**
 * High-level spin — manages bonus state machine automatically.
 *
 * Base game: fresh grid each spin, multipliers reset to 1.
 * Gold Spins: same grid/multipliers carry over between spins.
 * Feature buy: specialised starting grid built from featureModeKey.
 *
 * @param {object}      state
 * @param {string|null} featureModeKey  e.g. 'STEAMY_SPIN', 'BONUS_3', null
 */
function spin(state, featureModeKey = null) {
  const isBonus = state.bonusState.active;
  let startGrid;
  let spinOptions = {};

  if (isBonus) {
    startGrid = createBonusSpinGrid(state.grid); // fresh symbols + preserved multipliers
  } else if (featureModeKey && FEATURE_MODES[featureModeKey]) {
    const fg = createFeatureGrid(featureModeKey);
    startGrid = fg.startGrid;
    spinOptions = fg.spinOptions;
  } else {
    startGrid = createFreshGrid();
  }

  const result = resolveSpin(startGrid, isBonus, spinOptions);
  result.initialGrid = startGrid; // grid before any resolution (for frontend drop animation)

  let newBonus;
  if (isBonus) {
    const remaining = state.bonusState.spinsRemaining - 1;
    newBonus = remaining > 0
      ? { ...state.bonusState, spinsRemaining: remaining }
      : { active: false, spinsRemaining: 0, totalSpins: 0 };
  } else if (result.bonusTriggered) {
    newBonus = { active: true, spinsRemaining: result.bonusSpinsAwarded, totalSpins: result.bonusSpinsAwarded };
  } else {
    newBonus = { active: false, spinsRemaining: 0, totalSpins: 0 };
  }

  const newState = { grid: result.finalGrid, bonusState: newBonus, lastSpinPayout: result.totalPayout };
  return { result, newState };
}

// ─────────────────────────────────────────
// Math simulator (for RTP testing)
// ─────────────────────────────────────────

/**
 * Run N base-game spins and return math stats.
 * Call from a Node.js script to verify RTP before going live.
 *
 * @example
 *   const { simulateRtp } = require('./games/goldenShower/engine');
 *   console.log(simulateRtp(1_000_000));
 */
function simulateRtp(spins) {
  let totalPayout = 0;
  let hits = 0;
  let bonusTriggers = 0;
  let maxPayout = 0;

  for (let i = 0; i < spins; i++) {
    // Always simulate a fresh base-game spin (no carry-over state)
    const result = resolveSpin(createFreshGrid(), false);
    totalPayout += result.totalPayout;
    if (result.totalPayout > 0) hits++;
    if (result.bonusTriggered) bonusTriggers++;
    if (result.totalPayout > maxPayout) maxPayout = result.totalPayout;
  }

  return {
    spins,
    rtp: (totalPayout / spins) * 100,        // as percentage
    avgPayoutBetUnits: totalPayout / spins,
    hitRate: (hits / spins) * 100,
    bonusTriggerRate: (bonusTriggers / spins) * 100,
    maxSingleSpinPayout: maxPayout,
  };
}

// ─────────────────────────────────────────
// Exports
// ─────────────────────────────────────────

module.exports = {
  // Constants
  COLS, ROWS, PAYING_SYMBOLS, PAYOUT_TABLE, SYMBOL_WEIGHTS,
  // Feature modes
  FEATURE_MODES,
  // Grid
  createFreshGrid, cloneGrid, createFeatureGrid, createBonusSpinGrid,
  // Engine
  detectClusters, resolveSpin,
  // Session
  createInitialGameState, spin,
  // Math
  simulateRtp,
  // RNG
  setRng,
};

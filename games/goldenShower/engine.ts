/**
 * Golden Shower Slot Engine
 * Inspired by Nolimit City's "Golden Shower"
 *
 * Grid:   6 columns × 5 rows  (grid[col][row], col 0‑5, row 0‑4 top→bottom)
 * Wins:   Cluster Pays – 6+ connected symbols (horizontal / vertical)
 * Core:   Position multipliers, STEAM/WILD BURST/FLOATER/DRAIN fallbacks,
 *         Wild Generation, Bonus (Gold Spins) with persistent multipliers.
 */

// ─────────────────────────────────────────────────────────────
// 1. TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────

/** Paying symbols, ordered highest → lowest value */
export type PayingSymbol =
  | 'SOAP'          // 1 – highest
  | 'DUCK'          // 2
  | 'SPONGE'        // 3
  | 'TOILET_PAPER'  // 4
  | 'GREEN_PILL'    // 5
  | 'BRUSH'         // 6
  | 'SHAMPOO';      // 7 – lowest

/** Non-paying special symbols */
export type SpecialSymbol =
  | 'WILD'    // Toilet seat "W" – substitutes for any paying symbol
  | 'BONUS'   // Golden drain+gauge – triggers Gold Spins
  | 'STEAM'   // Fogged mirror     – upgrades a symbol tier before evaluation
  | 'DRAIN'   // Rusted grate      – clears all non-BONUS, randomises multipliers
  | 'FLOATER'; // Poop coin         – keeps one symbol type, clears the rest

export type SymbolType = PayingSymbol | SpecialSymbol;

export interface Cell {
  /** null = empty slot (filling via cascade) */
  symbol: SymbolType | null;
  /**
   * Position multiplier.
   * Default = 1. Set to 2 when a symbol is destroyed here.
   * Doubles each subsequent destruction (2→4→8…) up to 999.
   */
  multiplier: number;
}

/** 6 columns × 5 rows: grid[col][row] */
export type Grid = Cell[][];

export interface ClusterResult {
  symbolType: SymbolType;
  cells: [number, number][];  // [col, row]
  /**
   * Base payout in bet‑units from the payout table,
   * determined by cluster size bracket.
   */
  baseMultiplier: number;
  /** Sum of individual cell multipliers in this cluster. */
  cellMultiplierSum: number;
  /**
   * Final win for this cluster = baseMultiplier × cellMultiplierSum.
   * Multiply by the player's bet to get coins/credits.
   */
  totalMultiplier: number;
}

export type StepType =
  | 'STEAM_CONVERSION'
  | 'WIN'
  | 'WILD_BURST'
  | 'FLOATER_ACTIVATION'
  | 'DRAIN_ACTIVATION'
  | 'CASCADE';

export interface SpinStep {
  type: StepType;
  /** Deep-copy of the grid AFTER this step (use for animation sequencing). */
  grid: Grid;
  /** Payout added during this step, in bet‑units. */
  payout: number;
  // WIN
  clusters?: ClusterResult[];
  // STEAM_CONVERSION
  steamFrom?: PayingSymbol;
  steamTo?: PayingSymbol;
  // WILD_BURST
  wildBurstCells?: [number, number][];
  // FLOATER_ACTIVATION
  floaterSymbol?: PayingSymbol;
  // DRAIN_ACTIVATION
  drainCells?: [number, number][];
}

export interface SpinResult {
  /** Total win in bet‑units. Multiply by bet amount for real credits. */
  totalPayout: number;
  /** Ordered list of steps – drives the frontend animation sequence. */
  steps: SpinStep[];
  bonusTriggered: boolean;
  bonusSpinsAwarded: number;
  /** Grid state at the very end of the spin (ready for next spin). */
  finalGrid: Grid;
}

export interface BonusState {
  active: boolean;
  spinsRemaining: number;
  totalSpins: number;
}

export interface GameState {
  grid: Grid;
  bonusState: BonusState;
  /** Convenience field – balance management is left to the host server. */
  lastSpinPayout: number;
}

// ─────────────────────────────────────────────────────────────
// 2. CONSTANTS
// ─────────────────────────────────────────────────────────────

export const COLS = 6;
export const ROWS = 5;
export const MAX_MULTIPLIER = 999;

/**
 * Payout table expressed as bet‑unit multipliers.
 * Values verified against the official pay‑table screenshots
 * (0.20 bet → e.g. SOAP 14+ pays 1.20 = 6× bet).
 */
export const PAYOUT_TABLE: Record<
  PayingSymbol,
  { '6-8': number; '9-11': number; '12-13': number; '14+': number }
> = {
  SOAP:         { '6-8': 0.30, '9-11': 1.00, '12-13': 2.50, '14+': 6.00 },
  DUCK:         { '6-8': 0.20, '9-11': 0.50, '12-13': 1.50, '14+': 4.00 },
  SPONGE:       { '6-8': 0.20, '9-11': 0.50, '12-13': 1.00, '14+': 3.00 },
  TOILET_PAPER: { '6-8': 0.15, '9-11': 0.30, '12-13': 0.80, '14+': 2.50 },
  GREEN_PILL:   { '6-8': 0.15, '9-11': 0.30, '12-13': 0.70, '14+': 2.00 },
  BRUSH:        { '6-8': 0.10, '9-11': 0.20, '12-13': 0.60, '14+': 1.50 },
  SHAMPOO:      { '6-8': 0.10, '9-11': 0.20, '12-13': 0.50, '14+': 1.00 },
};

/** Ordered highest → lowest (index 0 = best). Used by STEAM upgrade logic. */
export const PAYING_SYMBOLS: PayingSymbol[] = [
  'SOAP', 'DUCK', 'SPONGE', 'TOILET_PAPER', 'GREEN_PILL', 'BRUSH', 'SHAMPOO',
];

/**
 * Symbol spawn weights.
 * Adjust these to tune RTP / volatility.
 *
 * ⚠  RTP CALIBRATION NOTE
 * In a 6×5 = 30-cell grid:
 *   P(symbol appears at least once) ≈ 1 - (1 - w/total)^30
 *
 * Run  simulateRtp(1_000_000)  and adjust until target ~96 % RTP is reached.
 */
const SYMBOL_WEIGHTS: Record<SymbolType, number> = {
  // Paying – must dominate the pool to keep specials rare
  SHAMPOO:      1000,
  BRUSH:         800,
  GREEN_PILL:    700,
  TOILET_PAPER:  600,
  SPONGE:        500,
  DUCK:          400,
  SOAP:          200,
  // Special – raise/lower to tune RTP and feature frequency
  WILD:           20,
  BONUS:          18,
  STEAM:          16,
  FLOATER:        12,
  DRAIN:           8,
};

const SYMBOL_WEIGHT_ENTRIES = Object.entries(SYMBOL_WEIGHTS) as [SymbolType, number][];
const TOTAL_WEIGHT = SYMBOL_WEIGHT_ENTRIES.reduce((s, [, w]) => s + w, 0);

// ─────────────────────────────────────────────────────────────
// 3. RNG HELPERS
// ─────────────────────────────────────────────────────────────

/** Pluggable RNG – replace with a seeded PRNG for reproducibility / provably fair. */
let _rng: () => number = Math.random;
export function setRng(fn: () => number): void { _rng = fn; }

function rng(): number { return _rng(); }

function weightedPick<T extends string>(
  entries: [T, number][],
  total: number,
): T {
  let r = rng() * total;
  for (const [sym, w] of entries) {
    r -= w;
    if (r <= 0) return sym;
  }
  return entries[entries.length - 1][0];
}

function pickFrom<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ─────────────────────────────────────────────────────────────
// 4. GRID UTILITIES
// ─────────────────────────────────────────────────────────────

export function createEmptyGrid(): Grid {
  return Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, (): Cell => ({ symbol: null, multiplier: 1 })),
  );
}

export function createFreshGrid(): Grid {
  return Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, (): Cell => ({
      symbol: weightedPick(SYMBOL_WEIGHT_ENTRIES, TOTAL_WEIGHT),
      multiplier: 1,
    })),
  );
}

export function cloneGrid(grid: Grid): Grid {
  return grid.map(col => col.map(cell => ({ ...cell })));
}

/**
 * Gravity / cascade:
 * Only SYMBOLS fall to the bottom of each column — the multiplier belongs
 * to the grid position (cell), not the symbol, so it must never move.
 * Empty slots at the top receive freshly generated symbols.
 * Each cell's multiplier is left completely untouched.
 */
function fillNulls(grid: Grid): Grid {
  const g = cloneGrid(grid);
  for (let col = 0; col < COLS; col++) {
    // Collect the symbols still present (preserving top→bottom order)
    const symbols = g[col]
      .filter(c => c.symbol !== null)
      .map(c => c.symbol as SymbolType);
    const missing = ROWS - symbols.length;
    // New symbols enter from the top
    const newSymbols: SymbolType[] = Array.from(
      { length: missing },
      () => weightedPick(SYMBOL_WEIGHT_ENTRIES, TOTAL_WEIGHT) as SymbolType,
    );
    const allSymbols = [...newSymbols, ...symbols];
    // Write only the symbol field — multipliers stay at their positions
    for (let row = 0; row < ROWS; row++) {
      g[col][row].symbol = allSymbols[row];
    }
  }
  return g;
}

function boostMultiplier(current: number): number {
  if (current < 2) return 2;
  return Math.min(current * 2, MAX_MULTIPLIER);
}

// ─────────────────────────────────────────────────────────────
// 5. CLUSTER DETECTION (BFS)
// ─────────────────────────────────────────────────────────────

/**
 * Find all winning clusters (6+ connected same‑type paying symbols).
 * WILDs are treated as matching any paying symbol they are adjacent to
 * (they extend clusters but don't seed their own).
 */
export function detectClusters(grid: Grid): ClusterResult[] {
  const visited = Array.from({ length: COLS }, () => new Array(ROWS).fill(false));
  const clusters: ClusterResult[] = [];

  // Helper: BFS from a seed, counting paying + adjacent wild cells
  function bfs(startCol: number, startRow: number, symType: PayingSymbol): [number, number][] {
    const cells: [number, number][] = [];
    const queue: [number, number][] = [[startCol, startRow]];
    visited[startCol][startRow] = true;

    while (queue.length > 0) {
      const [c, r] = queue.shift()!;
      cells.push([c, r]);

      const neighbours: [number, number][] = [
        [c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1],
      ];
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
      if (!sym || !PAYING_SYMBOLS.includes(sym as PayingSymbol)) continue;

      const cells = bfs(col, row, sym as PayingSymbol);
      if (cells.length < 6) continue;

      const base = getBasePayout(sym as PayingSymbol, cells.length);
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

function getBasePayout(sym: PayingSymbol, count: number): number {
  const t = PAYOUT_TABLE[sym];
  if (count >= 14) return t['14+'];
  if (count >= 12) return t['12-13'];
  if (count >= 9)  return t['9-11'];
  return t['6-8'];
}

// ─────────────────────────────────────────────────────────────
// 6. GRID MUTATIONS
// ─────────────────────────────────────────────────────────────

/** Remove winning cells and upgrade their position multipliers. */
function destroyClusterCells(grid: Grid, cells: [number, number][]): Grid {
  const g = cloneGrid(grid);
  for (const [col, row] of cells) {
    g[col][row].symbol = null;
    g[col][row].multiplier = boostMultiplier(g[col][row].multiplier);
  }
  return g;
}

/**
 * Wild Generation:
 * For each winning cluster, any off-cluster cells on the grid that share
 * the same symbol type are immediately converted to WILD.
 */
function applyWildGeneration(grid: Grid, clusters: ClusterResult[]): Grid {
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

// ─────────────────────────────────────────────────────────────
// 7. SPECIAL SYMBOL MECHANICS
// ─────────────────────────────────────────────────────────────

/**
 * STEAM (fogged mirror):
 * Fires before win evaluation. Picks a random paying symbol present
 * on the grid, converts ALL cells of that type (plus the STEAM cell
 * itself) into the next higher‑value paying symbol.
 * Returns null when no STEAM is on the grid.
 */
function resolveSteam(
  grid: Grid,
): { grid: Grid; from: PayingSymbol; to: PayingSymbol } | null {
  const steamCells: [number, number][] = [];
  const present = new Set<PayingSymbol>();

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = grid[col][row].symbol;
      if (s === 'STEAM') steamCells.push([col, row]);
      if (s && PAYING_SYMBOLS.includes(s as PayingSymbol)) present.add(s as PayingSymbol);
    }
  }

  if (steamCells.length === 0) return null;

  // Candidates: paying symbols that CAN be upgraded (anything except SOAP)
  const candidates = PAYING_SYMBOLS.filter(s => present.has(s) && PAYING_SYMBOLS.indexOf(s) > 0);

  const g = cloneGrid(grid);

  if (candidates.length === 0) {
    // No upgradeable symbols – just remove STEAM cells
    for (const [col, row] of steamCells) {
      g[col][row].symbol = null;
    }
    return null;
  }

  const from = pickFrom(candidates);
  const to = PAYING_SYMBOLS[PAYING_SYMBOLS.indexOf(from) - 1]; // upgrade = move toward index 0

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = g[col][row].symbol;
      if (s === from || s === 'STEAM') {
        g[col][row].symbol = to;
      }
    }
  }

  return { grid: g, from, to };
}

/**
 * WILD BURST (Fallback A):
 * If no winning cluster AND wilds exist:
 *   – Each wild destroys itself + its 4 orthogonal neighbours (skips BONUS cells).
 *   – Destroyed cells receive a 2× multiplier (or their existing one doubles).
 */
function resolveWildBurst(
  grid: Grid,
): { grid: Grid; destroyedCells: [number, number][] } | null {
  const wilds: [number, number][] = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[col][row].symbol === 'WILD') wilds.push([col, row]);
    }
  }
  if (wilds.length === 0) return null;

  const toDestroy = new Set<string>();
  for (const [col, row] of wilds) {
    toDestroy.add(`${col},${row}`);
    for (const [nc, nr] of [[col-1,row],[col+1,row],[col,row-1],[col,row+1]] as [number,number][]) {
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      if (grid[nc][nr].symbol === 'BONUS') continue; // BONUS is indestructible
      toDestroy.add(`${nc},${nr}`);
    }
  }

  const g = cloneGrid(grid);
  const destroyedCells: [number, number][] = [];
  for (const key of toDestroy) {
    const [col, row] = key.split(',').map(Number);
    g[col][row].symbol = null;
    g[col][row].multiplier = boostMultiplier(g[col][row].multiplier);
    destroyedCells.push([col, row]);
  }

  return { grid: g, destroyedCells };
}

/**
 * FLOATER / Poop‑coin (Fallback B):
 * Activates when: no wins, no wilds, AND a FLOATER symbol is on the grid.
 * Picks a random paying symbol present. Removes EVERYTHING except:
 *   – The chosen symbol type
 *   – BONUS symbols
 *   – DRAIN symbols
 * Removed cells get 2× multiplier (or doubled).
 */
function resolveFloater(
  grid: Grid,
): { grid: Grid; chosenSymbol: PayingSymbol; affectedCells: [number, number][] } | null {
  let floaterFound = false;
  const present: PayingSymbol[] = [];

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = grid[col][row].symbol;
      if (s === 'FLOATER') floaterFound = true;
      if (s && PAYING_SYMBOLS.includes(s as PayingSymbol) && !present.includes(s as PayingSymbol)) {
        present.push(s as PayingSymbol);
      }
    }
  }

  if (!floaterFound || present.length === 0) return null;

  const chosen = pickFrom(present);
  const g = cloneGrid(grid);
  const affectedCells: [number, number][] = [];

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
 * DRAIN / Rusted grate (Fallback C):
 * Activates when: no wins, no wilds, no FLOATER, AND a DRAIN symbol exists.
 * Removes DRAIN + every symbol except BONUS.
 * Every cleared cell's position multiplier is doubled (×2).
 */
function resolveDrain(
  grid: Grid,
): { grid: Grid; affectedCells: [number, number][] } | null {
  let drainFound = false;
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[col][row].symbol === 'DRAIN') { drainFound = true; break; }
    }
    if (drainFound) break;
  }
  if (!drainFound) return null;

  const g = cloneGrid(grid);
  const affectedCells: [number, number][] = [];

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const s = g[col][row].symbol;
      if (s === null || s === 'BONUS') continue;
      g[col][row].symbol = null;
      g[col][row].multiplier = boostMultiplier(g[col][row].multiplier); // always ×2
      affectedCells.push([col, row]);
    }
  }

  return { grid: g, affectedCells };
}

// ─────────────────────────────────────────────────────────────
// 8. BONUS DETECTION
// ─────────────────────────────────────────────────────────────

function countBonus(grid: Grid): number {
  let n = 0;
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[col][row].symbol === 'BONUS') n++;
    }
  }
  return n;
}

function bonusSpinsFor(count: number): number {
  if (count >= 5) return 10;
  if (count === 4) return 8;
  if (count >= 3) return 6;
  return 0;
}

// ─────────────────────────────────────────────────────────────
// 9. CORE SPIN RESOLVER
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a single spin from an initial grid.
 *
 * Execution order (mirrors Nolimit City's strict resolution):
 *   1. STEAM check → convert symbols, continue loop
 *   2. WIN evaluation → payout, wild-gen, destroy, multiply, cascade → loop
 *   3a. WILD BURST fallback → destroy, multiply, cascade → loop
 *   3b. FLOATER fallback   → clear grid, multiply, cascade → loop
 *   3c. DRAIN fallback     → clear grid, multiply, cascade → loop
 *   4. No triggers → spin over
 *
 * @param initialGrid  Grid at the start of this spin.
 * @param isBonus      During Gold Spins multipliers persist (don't reset here;
 *                     the caller is responsible for NOT resetting between bonus spins).
 */
export function resolveSpin(initialGrid: Grid, isBonus = false): SpinResult {
  let grid = cloneGrid(initialGrid);
  const steps: SpinStep[] = [];
  let totalPayout = 0;
  const MAX_ITER = 200; // safety guard against infinite loops
  let iter = 0;

  while (iter++ < MAX_ITER) {
    // ── 1. STEAM ──────────────────────────────────────────────
    const steam = resolveSteam(grid);
    if (steam) {
      grid = steam.grid;
      steps.push({
        type: 'STEAM_CONVERSION',
        grid: cloneGrid(grid),
        payout: 0,
        steamFrom: steam.from,
        steamTo: steam.to,
      });
      // STEAM conversion may have left nulls (if no candidate symbols were found
      // and cells were simply removed). Cascade to fill before re-evaluating.
      if (grid.some(col => col.some(cell => cell.symbol === null))) {
        grid = fillNulls(grid);
        steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      }
      continue;
    }

    // ── 2. WIN EVALUATION ─────────────────────────────────────
    const clusters = detectClusters(grid);
    if (clusters.length > 0) {
      // Wild Generation: convert off-cluster matches to WILD first
      grid = applyWildGeneration(grid, clusters);

      const stepPayout = clusters.reduce((s, c) => s + c.totalMultiplier, 0);
      totalPayout += stepPayout;

      // Destroy all winning cells and upgrade their position multipliers
      const allCells = clusters.flatMap(c => c.cells);
      grid = destroyClusterCells(grid, allCells);

      steps.push({
        type: 'WIN',
        grid: cloneGrid(grid),
        payout: stepPayout,
        clusters,
      });

      // Cascade
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // ── 3a. WILD BURST ────────────────────────────────────────
    const wildBurst = resolveWildBurst(grid);
    if (wildBurst) {
      grid = wildBurst.grid;
      steps.push({
        type: 'WILD_BURST',
        grid: cloneGrid(grid),
        payout: 0,
        wildBurstCells: wildBurst.destroyedCells,
      });
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // ── 3b. FLOATER ───────────────────────────────────────────
    const floater = resolveFloater(grid);
    if (floater) {
      grid = floater.grid;
      steps.push({
        type: 'FLOATER_ACTIVATION',
        grid: cloneGrid(grid),
        payout: 0,
        floaterSymbol: floater.chosenSymbol,
      });
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // ── 3c. DRAIN ─────────────────────────────────────────────
    const drain = resolveDrain(grid);
    if (drain) {
      grid = drain.grid;
      steps.push({
        type: 'DRAIN_ACTIVATION',
        grid: cloneGrid(grid),
        payout: 0,
        drainCells: drain.affectedCells,
      });
      grid = fillNulls(grid);
      steps.push({ type: 'CASCADE', grid: cloneGrid(grid), payout: 0 });
      continue;
    }

    // ── 4. SPIN OVER ──────────────────────────────────────────
    break;
  }

  // Bonus trigger check
  const bonusCount = countBonus(grid);
  const bonusSpinsAwarded = bonusSpinsFor(bonusCount);

  return {
    totalPayout,
    steps,
    bonusTriggered: bonusSpinsAwarded > 0,
    bonusSpinsAwarded,
    finalGrid: grid,
  };
}

// ─────────────────────────────────────────────────────────────
// 10. GAME SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────

export function createInitialGameState(): GameState {
  return {
    grid: createFreshGrid(),
    bonusState: { active: false, spinsRemaining: 0, totalSpins: 0 },
    lastSpinPayout: 0,
  };
}

/**
 * High‑level spin function.
 * Handles the bonus state machine so callers only need to call `spin()`.
 *
 * Base game: fresh grid each spin, multipliers reset.
 * Gold Spins: same grid carries over between spins, multipliers PERSIST.
 *
 * @returns { result, newState } – result for the frontend, newState to persist.
 */
export function spin(state: GameState): { result: SpinResult; newState: GameState } {
  const isBonus = state.bonusState.active;

  // Prepare the starting grid
  let startGrid: Grid;
  if (isBonus) {
    // Re-use current grid (keep multipliers)
    startGrid = cloneGrid(state.grid);
  } else {
    // Fresh grid, all multipliers reset to 1
    startGrid = createFreshGrid();
  }

  const result = resolveSpin(startGrid, isBonus);

  // Update bonus state
  let newBonus: BonusState;
  if (isBonus) {
    const remaining = state.bonusState.spinsRemaining - 1;
    newBonus = remaining > 0
      ? { ...state.bonusState, spinsRemaining: remaining }
      : { active: false, spinsRemaining: 0, totalSpins: 0 };
  } else if (result.bonusTriggered) {
    newBonus = {
      active: true,
      spinsRemaining: result.bonusSpinsAwarded,
      totalSpins: result.bonusSpinsAwarded,
    };
  } else {
    newBonus = { active: false, spinsRemaining: 0, totalSpins: 0 };
  }

  const newState: GameState = {
    grid: result.finalGrid,
    bonusState: newBonus,
    lastSpinPayout: result.totalPayout,
  };

  return { result, newState };
}

// ─────────────────────────────────────────────────────────────
// 11. GRID INSPECTION HELPERS  (useful for debugging / math sims)
// ─────────────────────────────────────────────────────────────

/** Pretty‑print a grid to the console (symbols + multipliers). */
export function printGrid(grid: Grid): void {
  for (let row = 0; row < ROWS; row++) {
    const line = Array.from({ length: COLS }, (_, col) => {
      const cell = grid[col][row];
      const sym = (cell.symbol ?? '    ').padEnd(12);
      const mul = cell.multiplier > 1 ? `[×${cell.multiplier}]` : '      ';
      return `${sym}${mul}`;
    }).join(' | ');
    console.log(line);
  }
  console.log('─'.repeat(COLS * 20));
}

/**
 * Run N simulated spins and return basic math stats.
 * Useful for verifying RTP before going live.
 */
export function simulateRtp(spins: number): {
  rtp: number;
  avgPayout: number;
  hitRate: number;
  bonusTriggerRate: number;
  maxSingleSpinPayout: number;
} {
  let totalPayout = 0;
  let hits = 0;
  let bonusTriggers = 0;
  let maxPayout = 0;
  let state = createInitialGameState();

  for (let i = 0; i < spins; i++) {
    const { result, newState } = spin(state);
    state = newState;
    totalPayout += result.totalPayout;
    if (result.totalPayout > 0) hits++;
    if (result.bonusTriggered) bonusTriggers++;
    if (result.totalPayout > maxPayout) maxPayout = result.totalPayout;
    // Don't carry bonus state into next standalone sim spin
    if (!state.bonusState.active) {
      state = createInitialGameState();
    }
  }

  return {
    rtp: totalPayout / spins,               // in bet-units; ×100 for %
    avgPayout: totalPayout / spins,
    hitRate: hits / spins,
    bonusTriggerRate: bonusTriggers / spins,
    maxSingleSpinPayout: maxPayout,
  };
}

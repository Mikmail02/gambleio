import { useState, useCallback, useRef, useEffect } from 'react';
import type { Grid, BonusState, SpinStep, VisualStage, VisualStageKind } from '../types';
import { COLS, ROWS, STAGE_DURATION, EXIT_DURATION } from '../constants';

// ─────────────────────────────────────────────────────────────
// Feature mode definitions (mirrors engine FEATURE_MODES)
// ─────────────────────────────────────────────────────────────

export interface FeatureModeDef {
  label: string;
  description: string;
  costMultiplier: number;
  section: 'bonus' | 'booster';
}

export const FEATURE_MODES: Record<string, FeatureModeDef> = {
  BONUS_3:        { label: '6 Gold Spins',        description: 'Guaranteed 3 BONUS symbols — triggers 6 Gold Spins',                           costMultiplier: 90,   section: 'bonus' },
  BONUS_4:        { label: '8 Gold Spins',        description: 'Guaranteed 4 BONUS symbols — triggers 8 Gold Spins',                           costMultiplier: 200,  section: 'bonus' },
  BONUS_5:        { label: '10 Gold Spins',       description: 'Guaranteed 5 BONUS symbols — triggers 10 Gold Spins',                          costMultiplier: 500,  section: 'bonus' },
  MYSTERY_BONUS:  { label: 'Lucky Draw',           description: '30% chance of 6, 40% of 8, or 30% of 10 Gold Spins',                          costMultiplier: 257,  section: 'bonus' },
  BONUS_HUNT:     { label: 'Bonus Hunt',           description: '3× more likely to trigger Gold Spins naturally',                               costMultiplier: 2,    section: 'booster' },
  STEAMY_SPIN:    { label: 'Steamy Spin ×16',     description: 'All position multipliers start at ×16',                                         costMultiplier: 20,   section: 'booster' },
  STEAMIER_SPIN:  { label: 'Steamier Spin ×64',   description: 'All position multipliers start at ×64',                                         costMultiplier: 80,   section: 'booster' },
  STEAMIEST_SPIN: { label: 'Steamiest Spin ×128', description: 'All positions ×128. Guaranteed DRAIN → its cell upgrades to ×999',             costMultiplier: 1969, section: 'booster' },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function cellKey(col: number, row: number) { return `${col},${row}`; }
function sleep(ms: number) { return new Promise<void>(res => setTimeout(res, ms)); }

function diffNewCells(prev: Grid, next: Grid): Set<string> {
  const s = new Set<string>();
  for (let col = 0; col < COLS; col++)
    for (let row = 0; row < ROWS; row++)
      if (prev[col][row].symbol === null && next[col][row].symbol !== null)
        s.add(cellKey(col, row));
  return s;
}

function allCellKeys(): Set<string> {
  const s = new Set<string>();
  for (let col = 0; col < COLS; col++)
    for (let row = 0; row < ROWS; row++)
      s.add(cellKey(col, row));
  return s;
}

function findSymbolCells(grid: Grid, symbols: string[]): Set<string> {
  const s = new Set<string>();
  const target = new Set(symbols);
  for (let col = 0; col < COLS; col++)
    for (let row = 0; row < ROWS; row++) {
      const sym = grid[col][row].symbol;
      if (sym && target.has(sym)) s.add(cellKey(col, row));
    }
  return s;
}

// ─────────────────────────────────────────────────────────────
// Visual stage builder
// ─────────────────────────────────────────────────────────────

function shouldTeaserDrop(featureMode: string | null, initialGrid: Grid): boolean {
  if (featureMode === 'MYSTERY_BONUS') return true;
  let bonusCount = 0;
  for (let col = 0; col <= 1; col++)
    for (let row = 0; row < ROWS; row++)
      if (initialGrid[col][row].symbol === 'BONUS') bonusCount++;
  return bonusCount >= 2;
}

function colCellKeys(col: number): Set<string> {
  const s = new Set<string>();
  for (let row = 0; row < ROWS; row++) s.add(cellKey(col, row));
  return s;
}

function buildVisualStages(
  steps: SpinStep[],
  initialGrid: Grid,
  opts: { featureMode?: string | null; isBonus?: boolean; bonusRetrigger?: number } = {},
): VisualStage[] {
  const stages: VisualStage[] = [];
  let prevGrid = initialGrid;
  let cumulativePayout = 0;

  function push(kind: VisualStageKind, grid: Grid, stageOpts: Partial<VisualStage> = {}) {
    stages.push({ kind, grid, cumulativePayout, duration: STAGE_DURATION[kind] ?? 600, ...stageOpts });
  }

  const bonusCells = findSymbolCells(initialGrid, ['BONUS']);
  const useTeaserDrop = shouldTeaserDrop(opts.featureMode ?? null, initialGrid);

  if (useTeaserDrop) {
    const TEASER_MS = 650;
    const colGroups: number[][] = [[0, 1], [2], [3], [4], [5]];
    let revealedCols = new Set<number>();
    for (const group of colGroups) {
      group.forEach(c => revealedCols.add(c));
      const hidden = new Set(
        Array.from({ length: COLS }, (_, c) => c).filter(c => !revealedCols.has(c)),
      );
      const newCells = group.reduce<Set<string>>((acc, c) => {
        colCellKeys(c).forEach(k => acc.add(k));
        return acc;
      }, new Set());
      push('INITIAL_DROP', initialGrid, {
        newCells,
        hiddenCols: hidden.size > 0 ? hidden : undefined,
        specialCells: bonusCells.size > 0 ? bonusCells : undefined,
        duration: TEASER_MS,
      });
    }
  } else {
    const bonusRetriggerCells =
      opts.isBonus && opts.bonusRetrigger && opts.bonusRetrigger > 0
        ? bonusCells
        : undefined;
    push('INITIAL_DROP', initialGrid, {
      newCells: allCellKeys(),
      specialCells: bonusCells.size > 0 ? bonusCells : undefined,
      bonusRetriggerCells,
    });
  }

  for (const step of steps) {
    cumulativePayout += step.payout;
    switch (step.type) {
      case 'WIN': {
        const glowCells = new Set(
          (step.clusters ?? []).flatMap(c => c.cells.map(([col, row]) => cellKey(col, row))),
        );
        push('HIGHLIGHT', prevGrid, { glowCells, label: buildWinLabel(step), cumulativePayout });
        push('EXPLODE', step.grid, { glowCells });
        break;
      }
      case 'CASCADE':
        push('CASCADE', step.grid, { newCells: diffNewCells(prevGrid, step.grid) });
        break;
      case 'WILD_BURST': {
        const wildCells = findSymbolCells(prevGrid, ['WILD']);
        push('WILD_FLASH', prevGrid, { glowCells: wildCells, specialCells: wildCells, label: 'WILD BURST!' });
        push('BURST', step.grid, {
          glowCells: new Set((step.wildBurstCells ?? []).map(([c, r]) => cellKey(c, r))),
        });
        break;
      }
      case 'STEAM_CONVERSION':
        push('PRE_SPECIAL', prevGrid, { specialCells: findSymbolCells(prevGrid, ['STEAM']), label: 'STEAM!' });
        push('SPECIAL', step.grid, { label: step.steamFrom ? `STEAM! ${step.steamFrom} → ${step.steamTo}` : 'STEAM!' });
        break;
      case 'FLOATER_ACTIVATION':
        push('PRE_SPECIAL', prevGrid, { specialCells: findSymbolCells(prevGrid, ['FLOATER']), label: 'FLOATER!' });
        push('SPECIAL', step.grid, { label: step.floaterSymbol ? `FLOATER! Keeping ${step.floaterSymbol}` : 'FLOATER!' });
        break;
      case 'DRAIN_ACTIVATION':
        push('PRE_SPECIAL', prevGrid, { specialCells: findSymbolCells(prevGrid, ['DRAIN']), label: 'DRAIN!' });
        push('SPECIAL', step.grid, { label: 'DRAIN! Clearing grid…' });
        break;
    }
    prevGrid = step.grid;
  }
  return stages;
}

function buildWinLabel(step: SpinStep): string {
  if (!step.clusters || step.clusters.length === 0) return 'WIN!';
  const total = step.clusters.reduce((s, c) => s + c.totalMultiplier, 0);
  return `WIN! ${total.toFixed(2)}× bet`;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GsStats {
  xp: number;
  totalSpins: number;
  totalWagered: number;
  totalWon: number;
  biggestWin: number;
  biggestWinMultiplier: number;
}

/** Values deferred until animations complete — avoids spoiling outcomes */
interface DeferredDisplay {
  balance: number;
  sessionProfit: number;
  sessionStats: GsStats;
  bonusState: BonusState;
}

export interface SpinPlayerState {
  displayGrid: Grid;
  glowCells: Set<string>;
  newCells: Set<string>;
  specialCells: Set<string>;
  hiddenCols: Set<number>;
  bonusRetriggerCells: Set<string>;
  isSpinning: boolean;
  isPlaying: boolean;
  isClearing: boolean;
  spinGen: number;
  /** Displayed balance — lags API response until animations complete */
  balance: number;
  bet: number;
  totalWin: number;
  /** Net profit/loss for this session — updated after animations */
  sessionProfit: number;
  /** Displayed bonus state — lags API response until animations complete */
  bonusState: BonusState;
  spinLabel: string;
  error: string | null;
  featureMode: string | null;
  activeBooster: string | null;
  autoSpinsRemaining: number;
  gsStats: GsStats;
  /** Session-only stats — start at zero each page load, updated after animations */
  sessionStats: GsStats;
  pendingBonusModal: { spinsAwarded: number } | null;
  bonusSummary: { totalWin: number } | null;
  scheduledSummary: { totalWin: number } | null;
  bonusRunWin: number;
}

function emptyGrid(): Grid {
  return Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => ({ symbol: null, multiplier: 1 })),
  );
}

const emptyStats: GsStats = {
  xp: 0, totalSpins: 0, totalWagered: 0, totalWon: 0, biggestWin: 0, biggestWinMultiplier: 0,
};

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useSpinPlayer(initialBalance: number) {
  const [state, setState] = useState<SpinPlayerState>({
    displayGrid: emptyGrid(),
    glowCells: new Set(),
    newCells: new Set(),
    specialCells: new Set(),
    hiddenCols: new Set(),
    bonusRetriggerCells: new Set(),
    isSpinning: false,
    isPlaying: false,
    isClearing: false,
    spinGen: 0,
    balance: initialBalance,
    bet: 1.00,
    totalWin: 0,
    sessionProfit: 0,
    bonusState: { active: false, spinsRemaining: 0, totalSpins: 0 },
    spinLabel: '',
    error: null,
    featureMode: null,
    activeBooster: null,
    autoSpinsRemaining: 0,
    gsStats: { ...emptyStats },
    sessionStats: { ...emptyStats },
    pendingBonusModal: null,
    bonusSummary: null,
    scheduledSummary: null,
    bonusRunWin: 0,
  });

  const timerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stagesRef        = useRef<VisualStage[]>([]);
  const stageIdxRef      = useRef(0);
  const pendingStagesRef = useRef<VisualStage[] | null>(null);

  // ── Stable refs for spin() closure — avoids stale state reads ──────────
  const betRef           = useRef(state.bet);
  const featureModeRef   = useRef(state.featureMode);
  const activeBoosterRef = useRef(state.activeBooster);
  // These mirror the DISPLAYED state values so spin() can compute deltas without prev
  const bonusStateRef    = useRef<BonusState>(state.bonusState);
  const sessionProfitRef = useRef(state.sessionProfit);
  const sessionStatsRef  = useRef<GsStats>(state.sessionStats);
  const bonusRunWinRef   = useRef(state.bonusRunWin);
  const gsStatsRef       = useRef<GsStats>(state.gsStats);

  useEffect(() => { betRef.current           = state.bet; },           [state.bet]);
  useEffect(() => { featureModeRef.current   = state.featureMode; },   [state.featureMode]);
  useEffect(() => { activeBoosterRef.current = state.activeBooster; }, [state.activeBooster]);
  useEffect(() => { bonusStateRef.current    = state.bonusState; },    [state.bonusState]);
  useEffect(() => { sessionProfitRef.current = state.sessionProfit; }, [state.sessionProfit]);
  useEffect(() => { sessionStatsRef.current  = state.sessionStats; },  [state.sessionStats]);
  useEffect(() => { bonusRunWinRef.current   = state.bonusRunWin; },   [state.bonusRunWin]);
  useEffect(() => { gsStatsRef.current       = state.gsStats; },       [state.gsStats]);

  // ── Deferred display — balance/stats/bonusState lag animations ─────────
  // Stored here after API response; flushed to React state when animations end.
  const pendingDisplayRef = useRef<DeferredDisplay | null>(null);

  /** Apply the pending balance/stats/bonusState to visible React state.
   *  Called when the current spin's animation sequence is fully complete. */
  const flushDisplay = useCallback(() => {
    const p = pendingDisplayRef.current;
    if (!p) return;
    pendingDisplayRef.current = null;
    setState(prev => ({
      ...prev,
      balance:       p.balance,
      sessionProfit: p.sessionProfit,
      sessionStats:  p.sessionStats,
      bonusState:    p.bonusState,
    }));
  }, []);

  const cancelPlayback = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** Advance through visual stages one at a time.
   *  onComplete fires when the last stage finishes — this is when display state flushes. */
  const playStage = useCallback((stages: VisualStage[], idx: number, onComplete?: () => void) => {
    if (idx >= stages.length) {
      setState(prev => ({
        ...prev,
        isPlaying: false,
        spinLabel: '',
        glowCells: new Set(),
        newCells: new Set(),
        specialCells: new Set(),
        hiddenCols: new Set(),
        bonusRetriggerCells: new Set(),
      }));
      onComplete?.();
      return;
    }
    const s = stages[idx];
    setState(prev => ({
      ...prev,
      displayGrid:         s.grid,
      glowCells:           s.glowCells           ?? new Set(),
      newCells:            s.newCells             ?? new Set(),
      specialCells:        s.specialCells         ?? new Set(),
      hiddenCols:          s.hiddenCols           ?? new Set(),
      bonusRetriggerCells: s.bonusRetriggerCells  ?? new Set(),
      totalWin:            s.cumulativePayout,
      spinLabel:           s.label ?? '',
    }));
    stageIdxRef.current = idx;
    timerRef.current = setTimeout(() => playStage(stages, idx + 1, onComplete), s.duration);
  }, []);

  /** Player clicks "START" on the bonus intro modal.
   *  This is the moment we flush display state (tracker appears, balance updates)
   *  and begin playing the win stages from the triggering spin. */
  const confirmBonusStart = useCallback(() => {
    const stages = pendingStagesRef.current;
    if (!stages) return;
    pendingStagesRef.current = null;
    // Flush NOW — balance/stats/bonusState become visible as bonus officially begins
    flushDisplay();
    setState(prev => ({ ...prev, pendingBonusModal: null, isPlaying: stages.length > 0 }));
    if (stages.length > 0) playStage(stages, 0);
  }, [playStage, flushDisplay]);

  const dismissBonusSummary = useCallback(() => {
    setState(prev => ({ ...prev, bonusSummary: null }));
  }, []);

  const spin = useCallback(async () => {
    cancelPlayback();
    setState(prev => ({
      ...prev,
      isSpinning: true,
      isClearing: true,
      totalWin: 0,
      spinLabel: '',
      glowCells: new Set(),
      newCells: new Set(),
      specialCells: new Set(),
      scheduledSummary: null,
      error: null,
    }));

    const token       = localStorage.getItem('gambleio_token');
    const bet         = betRef.current;
    const featureMode = featureModeRef.current ?? activeBoosterRef.current ?? null;

    try {
      const [data] = await Promise.all([
        fetch('/api/slots/golden-shower/spin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ bet, featureMode: featureMode ?? undefined }),
        }).then(async res => {
          const d = await res.json();
          if (!res.ok) throw new Error(d.error ?? 'Spin failed');
          return d;
        }),
        sleep(EXIT_DURATION),
      ]);

      const winAmount: number    = data.result.winAmount ?? 0;
      const bonusRetrigger: number = data.result.bonusRetrigger ?? 0;
      const justTriggered        = !!data.result.bonusTriggered;

      // ── Compute deferred display values using stable refs ─────────────
      // Using refs (not stale-closure `state`) ensures accuracy across async gaps.
      const wasInBonus     = bonusStateRef.current.active;
      // FIX 2: Use server-returned totalCost (reflects actual feature buy price)
      const spinCost       = wasInBonus ? 0 : (data.totalCost ?? bet);
      const isExitingBonus = wasInBonus && !data.bonusState.active;

      let newBonusRunWin = bonusRunWinRef.current;
      if (wasInBonus) newBonusRunWin = bonusRunWinRef.current + winAmount;
      if (justTriggered && !wasInBonus) newBonusRunWin = winAmount;

      const xpDelta = Math.max(0, (data.gsStats?.xp ?? gsStatsRef.current.xp) - gsStatsRef.current.xp);
      const newSessionStats: GsStats = {
        totalSpins:          sessionStatsRef.current.totalSpins + 1,
        totalWagered:        sessionStatsRef.current.totalWagered + spinCost,
        totalWon:            sessionStatsRef.current.totalWon + winAmount,
        biggestWin:          Math.max(sessionStatsRef.current.biggestWin, winAmount),
        biggestWinMultiplier: Math.max(sessionStatsRef.current.biggestWinMultiplier, winAmount / Math.max(bet, 0.01)),
        xp:                  sessionStatsRef.current.xp + xpDelta,
      };
      const newSessionProfit = sessionProfitRef.current + winAmount - spinCost;

      // FIX 1: Store display updates in ref — applied AFTER animations finish.
      // This prevents balance/stats/bonusState from spoiling the spin result.
      pendingDisplayRef.current = {
        balance:       data.balance,
        sessionProfit: newSessionProfit,
        sessionStats:  newSessionStats,
        bonusState:    data.bonusState,
      };

      // ── Build visual stages ───────────────────────────────────────────
      const stages = buildVisualStages(data.result.steps, data.result.initialGrid, {
        featureMode,
        isBonus: wasInBonus,
        bonusRetrigger,
      });
      stagesRef.current = stages;

      // ── Split stages: INITIAL_DROP always plays before modal fires ──────
      // This is the universal animation lock — pendingBonusModal is NEVER set
      // directly from the API response; only set in the dropStages onComplete callback.
      const dropStages = justTriggered ? stages.filter(s => s.kind === 'INITIAL_DROP') : [];
      const winStages  = justTriggered ? stages.filter(s => s.kind !== 'INITIAL_DROP') : [];

      // ── setState: only non-spoiler fields updated immediately ─────────
      setState(prev => ({
        ...prev,
        isSpinning:    false,
        isClearing:    false,
        isPlaying:     justTriggered ? dropStages.length > 0 : stages.length > 0,
        spinGen:       prev.spinGen + 1,
        featureMode:   null,
        autoSpinsRemaining: (justTriggered || isExitingBonus) ? 0
          : prev.autoSpinsRemaining > 0 ? prev.autoSpinsRemaining - 1 : 0,
        gsStats:       data.gsStats ?? prev.gsStats,
        bonusRunWin:   newBonusRunWin,
        // pendingBonusModal is NEVER set here — always via animation callback
        scheduledSummary: isExitingBonus ? { totalWin: newBonusRunWin } : null,
        bonusSummary: null,
        // balance, sessionProfit, sessionStats, bonusState → via pendingDisplayRef
      }));

      const spinsAwarded = data.result.bonusSpinsAwarded as number;

      if (justTriggered) {
        // Always play ALL drop stages first, THEN show the modal.
        // Works for both teaser (5 INITIAL_DROP stages) and non-teaser (1 INITIAL_DROP).
        pendingStagesRef.current = winStages;
        if (dropStages.length > 0) {
          playStage(dropStages, 0, () => {
            setState(prev => ({ ...prev, pendingBonusModal: { spinsAwarded }, isPlaying: false }));
          });
        } else {
          // Guard: no drop stages found (shouldn't happen)
          setState(prev => ({ ...prev, pendingBonusModal: { spinsAwarded } }));
        }
      } else if (stages.length > 0) {
        // Normal spin OR bonus spin: flush display when all animations complete
        playStage(stages, 0, flushDisplay);
      } else {
        // No stages (shouldn't happen but guard it)
        flushDisplay();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      // On error, flush any pending display so state doesn't get stuck
      flushDisplay();
      setState(prev => ({
        ...prev,
        isSpinning: false,
        isClearing: false,
        isPlaying: false,
        scheduledSummary: null,
        autoSpinsRemaining: 0,
        error: msg,
      }));
    }
  }, [cancelPlayback, playStage, flushDisplay]);

  const setBet           = useCallback((bet: number) => setState(prev => ({ ...prev, bet })), []);
  const setFeatureMode   = useCallback((fm: string | null) => setState(prev => ({ ...prev, featureMode: fm })), []);
  const setActiveBooster = useCallback((key: string | null) => setState(prev => ({ ...prev, activeBooster: key })), []);
  const setAutoSpins     = useCallback((n: number) => setState(prev => ({ ...prev, autoSpinsRemaining: n })), []);

  // Auto-spin: fire when playback idle, no modals, no pending summary
  useEffect(() => {
    if (!state.isPlaying && !state.isSpinning && !state.isClearing
        && !state.pendingBonusModal && !state.bonusSummary && !state.scheduledSummary
        && state.autoSpinsRemaining > 0) {
      spin();
    }
  }, [state.isPlaying, state.isSpinning, state.isClearing,
      state.pendingBonusModal, state.bonusSummary, state.scheduledSummary,
      state.autoSpinsRemaining, spin]);

  // Delayed bonus summary — shows 2s AFTER final spin's animations complete
  useEffect(() => {
    if (!state.isPlaying && !state.isSpinning && !state.isClearing && state.scheduledSummary) {
      const summary = state.scheduledSummary;
      const t = setTimeout(() => {
        setState(prev => {
          if (prev.isSpinning || prev.isPlaying) return prev;
          return { ...prev, bonusSummary: summary, scheduledSummary: null };
        });
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [state.isPlaying, state.isSpinning, state.isClearing, state.scheduledSummary]);

  // Load initial state on mount — sets balance/grid from server.
  // sessionStats intentionally NOT loaded so it resets to zero each page visit.
  useEffect(() => {
    const token = localStorage.getItem('gambleio_token');
    fetch('/api/slots/golden-shower/state', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => {
        setState(prev => ({
          ...prev,
          displayGrid: data.grid      ?? prev.displayGrid,
          bonusState:  data.bonusState ?? prev.bonusState,
          balance:     typeof data.balance === 'number' ? data.balance : prev.balance,
          gsStats:     data.gsStats    ?? prev.gsStats,
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => cancelPlayback(), [cancelPlayback]);

  return { state, spin, setBet, setFeatureMode, setActiveBooster, setAutoSpins, confirmBonusStart, dismissBonusSummary };
}

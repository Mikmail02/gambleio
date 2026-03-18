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

function buildVisualStages(steps: SpinStep[], initialGrid: Grid): VisualStage[] {
  const stages: VisualStage[] = [];
  let prevGrid = initialGrid;
  let cumulativePayout = 0;

  function push(kind: VisualStageKind, grid: Grid, opts: Partial<VisualStage> = {}) {
    stages.push({ kind, grid, cumulativePayout, duration: STAGE_DURATION[kind] ?? 600, ...opts });
  }

  // Highlight any BONUS symbols in the initial drop so the player notices them
  const bonusSpecialCells = findSymbolCells(initialGrid, ['BONUS']);
  push('INITIAL_DROP', initialGrid, {
    newCells: allCellKeys(),
    specialCells: bonusSpecialCells.size > 0 ? bonusSpecialCells : undefined,
  });

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

export interface SpinPlayerState {
  displayGrid: Grid;
  glowCells: Set<string>;
  newCells: Set<string>;
  specialCells: Set<string>;
  isSpinning: boolean;
  isPlaying: boolean;
  isClearing: boolean;
  spinGen: number;
  balance: number;
  bet: number;
  totalWin: number;
  bonusState: BonusState;
  spinLabel: string;
  error: string | null;
  /** One-shot feature buy (BONUS_3 etc.) — cleared after spin fires */
  featureMode: string | null;
  /** Persistent booster (STEAMY_SPIN etc.) — stays until explicitly cleared */
  activeBooster: string | null;
  autoSpinsRemaining: number;
  gsStats: GsStats;
  /** Set when bonus just triggered — shows intro modal before playback starts */
  pendingBonusModal: { spinsAwarded: number } | null;
  /** Set when bonus round ends — shows total win summary */
  bonusSummary: { totalWin: number } | null;
  /** Win accumulated during the current bonus run */
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
    isSpinning: false,
    isPlaying: false,
    isClearing: false,
    spinGen: 0,
    balance: initialBalance,
    bet: 1.00,
    totalWin: 0,
    bonusState: { active: false, spinsRemaining: 0, totalSpins: 0 },
    spinLabel: '',
    error: null,
    featureMode: null,
    activeBooster: null,
    autoSpinsRemaining: 0,
    gsStats: { ...emptyStats },
    pendingBonusModal: null,
    bonusSummary: null,
    bonusRunWin: 0,
  });

  const timerRef         = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stagesRef        = useRef<VisualStage[]>([]);
  const stageIdxRef      = useRef(0);
  const pendingStagesRef = useRef<VisualStage[] | null>(null); // stages held until bonus modal dismissed

  // Stable refs to avoid stale closures inside the async spin()
  const betRef          = useRef(state.bet);
  const featureModeRef  = useRef(state.featureMode);
  const activeBoosterRef= useRef(state.activeBooster);
  useEffect(() => { betRef.current = state.bet; },           [state.bet]);
  useEffect(() => { featureModeRef.current = state.featureMode; },     [state.featureMode]);
  useEffect(() => { activeBoosterRef.current = state.activeBooster; }, [state.activeBooster]);

  const cancelPlayback = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const playStage = useCallback((stages: VisualStage[], idx: number) => {
    if (idx >= stages.length) {
      setState(prev => ({
        ...prev,
        isPlaying: false,
        spinLabel: '',
        glowCells: new Set(),
        newCells: new Set(),
        specialCells: new Set(),
      }));
      return;
    }
    const s = stages[idx];
    setState(prev => ({
      ...prev,
      displayGrid: s.grid,
      glowCells:    s.glowCells    ?? new Set(),
      newCells:     s.newCells     ?? new Set(),
      specialCells: s.specialCells ?? new Set(),
      totalWin:     s.cumulativePayout,
      spinLabel:    s.label ?? '',
    }));
    stageIdxRef.current = idx;
    timerRef.current = setTimeout(() => playStage(stages, idx + 1), s.duration);
  }, []);

  /** Called when player clicks "START" on the bonus intro modal */
  const confirmBonusStart = useCallback(() => {
    const stages = pendingStagesRef.current;
    if (!stages) return;
    pendingStagesRef.current = null;
    setState(prev => ({ ...prev, pendingBonusModal: null, isPlaying: stages.length > 0 }));
    if (stages.length > 0) playStage(stages, 0);
  }, [playStage]);

  /** Dismiss the bonus summary overlay */
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
      error: null,
    }));

    const token       = localStorage.getItem('gambleio_token');
    const bet         = betRef.current;
    // One-shot feature buy takes priority over persistent booster
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

      const winAmount: number = data.result.winAmount ?? 0;
      const stages = buildVisualStages(data.result.steps, data.result.initialGrid);
      stagesRef.current = stages;

      setState(prev => {
        const wasInBonus      = prev.bonusState.active;
        const nowInBonus      = data.bonusState.active;
        const justTriggered   = !!data.result.bonusTriggered;

        // Accumulate bonus run win
        let newBonusRunWin = prev.bonusRunWin;
        if (wasInBonus) newBonusRunWin = prev.bonusRunWin + winAmount;
        // Reset counter when a new bonus just started
        if (justTriggered && !wasInBonus) newBonusRunWin = winAmount;

        const isExitingBonus  = wasInBonus && !nowInBonus;

        return {
          ...prev,
          isSpinning:    false,
          isClearing:    false,
          // If bonus just triggered, hold playback until player clicks START
          isPlaying:     !justTriggered && stages.length > 0,
          balance:       data.balance,
          bonusState:    data.bonusState,
          spinGen:       prev.spinGen + 1,
          featureMode:   null,          // always clear one-shot after firing
          // Clear auto-spin when bonus triggers or when bonus ends (natural break point)
        autoSpinsRemaining: (justTriggered || isExitingBonus) ? 0 : (prev.autoSpinsRemaining > 0 ? prev.autoSpinsRemaining - 1 : 0),
          gsStats:       data.gsStats ?? prev.gsStats,
          bonusRunWin:   newBonusRunWin,
          pendingBonusModal: justTriggered ? { spinsAwarded: data.result.bonusSpinsAwarded } : prev.pendingBonusModal,
          bonusSummary:  isExitingBonus ? { totalWin: newBonusRunWin } : prev.bonusSummary,
        };
      });

      if (data.result.bonusTriggered) {
        // Hold stages until player clicks START in intro modal
        pendingStagesRef.current = stages;
      } else if (stages.length > 0) {
        playStage(stages, 0);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isSpinning: false,
        isClearing: false,
        isPlaying: false,
        autoSpinsRemaining: 0,
        error: msg,
      }));
    }
  }, [cancelPlayback, playStage]);

  const setBet           = useCallback((bet: number) => setState(prev => ({ ...prev, bet })), []);
  const setFeatureMode   = useCallback((fm: string | null) => setState(prev => ({ ...prev, featureMode: fm })), []);
  const setActiveBooster = useCallback((key: string | null) => setState(prev => ({ ...prev, activeBooster: key })), []);
  const setAutoSpins     = useCallback((n: number) => setState(prev => ({ ...prev, autoSpinsRemaining: n })), []);

  // Auto-spin: fire next spin when playback ends.
  // Block when bonus intro or summary modals are open — those are natural break points.
  useEffect(() => {
    if (!state.isPlaying && !state.isSpinning && !state.isClearing
        && !state.pendingBonusModal && !state.bonusSummary
        && state.autoSpinsRemaining > 0) {
      spin();
    }
  }, [state.isPlaying, state.isSpinning, state.isClearing, state.pendingBonusModal, state.bonusSummary, state.autoSpinsRemaining, spin]);

  // Load initial state on mount
  useEffect(() => {
    const token = localStorage.getItem('gambleio_token');
    fetch('/api/slots/golden-shower/state', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => {
        if (data.grid) {
          setState(prev => ({
            ...prev,
            displayGrid: data.grid,
            bonusState: data.bonusState ?? prev.bonusState,
          }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => cancelPlayback(), [cancelPlayback]);

  return { state, spin, setBet, setFeatureMode, setActiveBooster, setAutoSpins, confirmBonusStart, dismissBonusSummary };
}

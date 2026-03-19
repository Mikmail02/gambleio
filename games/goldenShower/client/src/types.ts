// Mirrors the engine types – keep in sync with games/goldenShower/engine.js

export type PayingSymbol =
  | 'SOAP' | 'DUCK' | 'SPONGE' | 'TOILET_PAPER' | 'GREEN_PILL' | 'BRUSH' | 'SHAMPOO';

export type SpecialSymbol = 'WILD' | 'BONUS' | 'STEAM' | 'DRAIN' | 'FLOATER';
export type SymbolType = PayingSymbol | SpecialSymbol;

export interface Cell {
  symbol: SymbolType | null;
  multiplier: number;
}

export type Grid = Cell[][]; // [col][row]

export interface ClusterResult {
  symbolType: SymbolType;
  cells: [number, number][];
  baseMultiplier: number;
  cellMultiplierSum: number;
  totalMultiplier: number;
}

export type StepType =
  | 'STEAM_CONVERSION' | 'WIN' | 'WILD_BURST'
  | 'FLOATER_ACTIVATION' | 'DRAIN_ACTIVATION' | 'CASCADE';

export interface SpinStep {
  type: StepType;
  grid: Grid;
  payout: number;
  clusters?: ClusterResult[];
  steamFrom?: PayingSymbol;
  steamTo?: PayingSymbol;
  wildBurstCells?: [number, number][];
  floaterSymbol?: PayingSymbol;
  drainCells?: [number, number][];
}

export interface BonusState {
  active: boolean;
  spinsRemaining: number;
  totalSpins: number;
}

export interface SpinApiResult {
  initialGrid: Grid;
  totalPayoutMultiplier: number;
  winAmount: number;
  steps: SpinStep[];
  bonusTriggered: boolean;
  bonusSpinsAwarded: number;
  bonusRetrigger: number;
  finalGrid: Grid;
}

export interface SpinApiResponse {
  result: SpinApiResult;
  bonusState: BonusState;
  balance: number;
}

// ── Visual stage ──────────────────────────────────────────────────────────────

export type VisualStageKind =
  | 'INITIAL_DROP'   // full 6×5 grid rains in at spin start
  | 'PRE_SPECIAL'    // special symbol glows before it fires (STEAM/DRAIN/FLOATER)
  | 'HIGHLIGHT'      // winning cluster cells glow before destruction
  | 'EXPLODE'        // symbols removed, multiplier badges appear
  | 'WILD_FLASH'     // wilds glow before bursting
  | 'BURST'          // wilds + neighbours destroyed
  | 'SPECIAL'        // post-activation result grid
  | 'CASCADE';       // new symbols falling in

export interface VisualStage {
  kind: VisualStageKind;
  grid: Grid;
  /** Win-cluster cells – yellow glow */
  glowCells?: Set<string>;
  /** Cells that just appeared – fall from top */
  newCells?: Set<string>;
  /** Special-symbol cells – per-symbol colored glow */
  specialCells?: Set<string>;
  /** Columns hidden during teaser drop (col indices not yet revealed) */
  hiddenCols?: Set<number>;
  /** BONUS cells that award +1 spin during an active bonus round */
  bonusRetriggerCells?: Set<string>;
  cumulativePayout: number;
  label?: string;
  duration: number;
}

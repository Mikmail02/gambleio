import type { SymbolType } from './types';

export const COLS = 6;
export const ROWS = 5;

/**
 * Map backend symbol IDs to asset filenames.
 * Place PNGs in  public/golden-shower/assets/
 */
export const ASSET_MAP: Record<SymbolType, string> = {
  SOAP:         '/golden-shower/assets/symbols/soap.png',
  DUCK:         '/golden-shower/assets/symbols/duck.png',
  SPONGE:       '/golden-shower/assets/symbols/sponge.png',
  TOILET_PAPER: '/golden-shower/assets/symbols/toilet_paper.png',
  GREEN_PILL:   '/golden-shower/assets/symbols/green_pill.png',
  BRUSH:        '/golden-shower/assets/symbols/brush.png',
  SHAMPOO:      '/golden-shower/assets/symbols/shampoo.png',
  WILD:         '/golden-shower/assets/symbols/wild.png',
  BONUS:        '/golden-shower/assets/symbols/bonus.png',
  STEAM:        '/golden-shower/assets/symbols/steam.png',
  DRAIN:        '/golden-shower/assets/symbols/drain.png',
  FLOATER:      '/golden-shower/assets/symbols/floater.png',
};

export const SYMBOL_LABEL: Record<SymbolType, string> = {
  SOAP: 'Soap', DUCK: 'Duck', SPONGE: 'Sponge', TOILET_PAPER: 'Toilet Paper',
  GREEN_PILL: 'Green Pill', BRUSH: 'Brush', SHAMPOO: 'Shampoo',
  WILD: 'Wild', BONUS: 'Bonus', STEAM: 'Steam', DRAIN: 'Drain', FLOATER: 'Floater',
};

/** ms durations per visual stage kind */
export const STAGE_DURATION: Record<string, number> = {
  INITIAL_DROP: 950,   // enough for all 30 cells to finish their staggered spring
  PRE_SPECIAL:  900,   // special symbol glows before firing
  HIGHLIGHT:    550,
  EXPLODE:      350,
  WILD_FLASH:  1400,   // wilds pulse dramatically before burst
  BURST:        550,
  SPECIAL:      500,   // result after special fires
  CASCADE:      600,
};

/** ms the board-clear exit animation plays before new symbols enter */
export const EXIT_DURATION = 420;

/** Symbol IDs that receive colored glow treatment */
export const SPECIAL_SYMBOL_TYPES = new Set(['WILD', 'BONUS', 'STEAM', 'DRAIN', 'FLOATER']);

export const BET_OPTIONS = [0.20, 0.40, 1.00, 2.00, 5.00, 10.00, 20.00, 50.00, 100.00, 200.00, 400.00];

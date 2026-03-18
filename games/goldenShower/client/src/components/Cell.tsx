import { AnimatePresence, motion } from 'framer-motion';
import type { Cell as CellType } from '../types';
import { ASSET_MAP, ROWS } from '../constants';
import styles from './Cell.module.css';

interface CellProps {
  cell: CellType;
  isGlowing: boolean;
  isNew: boolean;
  isExiting: boolean;
  isSpecial: boolean;
  spinGen: number;
  col: number;
  row: number;
}

function symbolKey(cell: CellType, col: number, row: number, spinGen: number) {
  return cell.symbol
    ? `${cell.symbol}-${col}-${row}-${spinGen}`
    : `empty-${col}-${row}-${spinGen}`;
}

/** Tier class applied to .multBg based on multiplier value */
function multTierClass(mult: number): string {
  if (mult >= 999) return styles.tier5;
  if (mult >= 64)  return styles.tier4;
  if (mult >= 16)  return styles.tier3;
  if (mult >= 4)   return styles.tier2;
  return styles.tier1; // x2
}

function getSpecialClass(symbol: string | null, s: Record<string, string>): string {
  switch (symbol) {
    case 'WILD':    return s.specialWild;
    case 'BONUS':   return s.specialBonus;
    case 'STEAM':   return s.specialSteam;
    case 'DRAIN':   return s.specialDrain;
    case 'FLOATER': return s.specialFloater;
    default:        return '';
  }
}

export function Cell({ cell, isGlowing, isNew, isExiting, isSpecial, spinGen, col, row }: CellProps) {
  const cascadeDelay = isNew ? col * 0.04 + row * 0.02 : 0;
  const specialClass = isSpecial ? getSpecialClass(cell.symbol, styles) : '';

  const cellClass = [
    styles.cell,
    isGlowing ? styles.glowing : '',
    specialClass,
  ].filter(Boolean).join(' ');

  return (
    <div className={cellClass}>

      {/* ── Persistent multiplier background layer ─────────────────── */}
      {/*    Lives BELOW the symbol (z-index 0 vs symbol's z-index 1)  */}
      <AnimatePresence>
        {cell.multiplier > 1 && (
          <motion.div
            key={`mbg-${col}-${row}-${cell.multiplier}`}
            className={`${styles.multBg} ${multTierClass(cell.multiplier)}`}
            initial={{ scale: 1.18, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 440, damping: 20 }}
          >
            <span className={styles.multText}>
              ×{cell.multiplier === 999 ? 'MAX' : cell.multiplier}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Symbol image (on top of multiplier bg) ─────────────────── */}
      <AnimatePresence mode="popLayout">
        {cell.symbol && (
          <motion.div
            key={symbolKey(cell, col, row, spinGen)}
            className={styles.symbolWrapper}
            initial={
              isNew
                ? { y: -90, opacity: 0, scale: 0.85 }
                : { scale: 0.6, opacity: 0 }
            }
            animate={
              isExiting
                ? { y: 80, opacity: 0, scale: 0.9 }
                : { y: 0, scale: 1, opacity: 1 }
            }
            exit={{ scale: 0, opacity: 0, rotate: 20, transition: { duration: 0.18 } }}
            transition={
              isExiting
                ? {
                    duration: 0.28,
                    ease: 'easeIn',
                    delay: (ROWS - 1 - row) * 0.025 + col * 0.015,
                  }
                : {
                    type: 'spring',
                    stiffness: 340,
                    damping: 22,
                    delay: cascadeDelay,
                  }
            }
          >
            <img
              src={ASSET_MAP[cell.symbol]}
              alt={cell.symbol}
              className={styles.symbolImg}
              draggable={false}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

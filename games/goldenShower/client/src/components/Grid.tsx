import { AnimatePresence, motion } from 'framer-motion';
import type { Grid as GridType } from '../types';
import { COLS, ROWS } from '../constants';
import { Cell } from './Cell';
import styles from './Grid.module.css';

interface GridProps {
  grid: GridType;
  glowCells: Set<string>;
  newCells: Set<string>;
  specialCells: Set<string>;
  hiddenCols?: Set<number>;
  bonusRetriggerCells?: Set<string>;
  isExiting: boolean;
  spinGen: number;
}

export function Grid({
  grid, glowCells, newCells, specialCells,
  hiddenCols, bonusRetriggerCells,
  isExiting, spinGen,
}: GridProps) {
  const rows = Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => ({ cell: grid[col][row], col, row })),
  );

  return (
    <div
      className={styles.grid}
      style={{
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      }}
    >
      {rows.flat().map(({ cell, col, row }) => {
        const key = `${col}-${row}`;
        const ck  = `${col},${row}`;
        const isHidden = hiddenCols?.has(col) ?? false;
        const isRetrigger = bonusRetriggerCells?.has(ck) ?? false;

        return (
          <div key={key} className={styles.cellWrapper}>
            <Cell
              cell={cell}
              col={col}
              row={row}
              isGlowing={glowCells.has(ck)}
              isNew={newCells.has(ck)}
              isSpecial={specialCells.has(ck)}
              isExiting={isExiting}
              isHidden={isHidden}
              spinGen={spinGen}
            />

            {/* +1 popup when BONUS re-triggers during Gold Spins */}
            <AnimatePresence>
              {isRetrigger && (
                <motion.div
                  key={`retrigger-${ck}-${spinGen}`}
                  className={styles.plusOne}
                  initial={{ y: 0, opacity: 1, scale: 0.8 }}
                  animate={{ y: -52, opacity: 0, scale: 1.2 }}
                  exit={{}}
                  transition={{ duration: 1.1, ease: 'easeOut' }}
                >
                  +1
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

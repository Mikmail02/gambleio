import type { Grid as GridType } from '../types';
import { COLS, ROWS } from '../constants';
import { Cell } from './Cell';
import styles from './Grid.module.css';

interface GridProps {
  grid: GridType;
  glowCells: Set<string>;
  newCells: Set<string>;
  specialCells: Set<string>;
  isExiting: boolean;
  spinGen: number;
}

export function Grid({ grid, glowCells, newCells, specialCells, isExiting, spinGen }: GridProps) {
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
      {rows.flat().map(({ cell, col, row }) => (
        <Cell
          key={`${col}-${row}`}
          cell={cell}
          col={col}
          row={row}
          isGlowing={glowCells.has(`${col},${row}`)}
          isNew={newCells.has(`${col},${row}`)}
          isSpecial={specialCells.has(`${col},${row}`)}
          isExiting={isExiting}
          spinGen={spinGen}
        />
      ))}
    </div>
  );
}

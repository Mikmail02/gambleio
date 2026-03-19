import { motion, AnimatePresence } from 'framer-motion';
import type { BonusState } from '../types';
import styles from './BonusTracker.module.css';

interface BonusTrackerProps {
  bonusState: BonusState;
}

export function BonusTracker({ bonusState }: BonusTrackerProps) {
  const { active, spinsRemaining, totalSpins } = bonusState;

  return (
    <AnimatePresence>
      {active && (
        <motion.aside
          className={styles.tracker}
          initial={{ opacity: 0, x: 24, scale: 0.92 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 24, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        >
          {/* Header */}
          <div className={styles.header}>
            <span className={styles.star}>⭐</span>
            <span className={styles.headerText}>BONUS<br />ACTIVE</span>
          </div>

          {/* Spin counter */}
          <div className={styles.counter}>
            <span className={styles.countNum}>{spinsRemaining}</span>
            <span className={styles.countLabel}>spins left</span>
          </div>

          {/* Visual spin dots */}
          <div className={styles.dots}>
            {Array.from({ length: totalSpins }, (_, i) => (
              <motion.div
                key={i}
                className={`${styles.dot} ${i < spinsRemaining ? styles.dotActive : styles.dotUsed}`}
                animate={i < spinsRemaining ? { scale: [1, 1.15, 1] } : {}}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.12 }}
              />
            ))}
          </div>

          {/* Progress bar */}
          <div className={styles.progressBg}>
            <motion.div
              className={styles.progressFill}
              animate={{ width: `${(spinsRemaining / totalSpins) * 100}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 24 }}
            />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

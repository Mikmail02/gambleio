import { motion } from 'framer-motion';
import styles from './BonusModals.module.css';

// ── Bonus Intro Modal ────────────────────────────────────────────────
interface BonusIntroModalProps {
  spinsAwarded: number;
  onStart: () => void;
}

export function BonusIntroModal({ spinsAwarded, onStart }: BonusIntroModalProps) {
  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className={styles.introPanel}
        initial={{ scale: 0.72, y: 50, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.88, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      >
        <div className={styles.introBurst}>⭐</div>
        <h2 className={styles.introTitle}>BONUS TRIGGERED!</h2>
        <p className={styles.introSubtitle}>
          YOU WON <span className={styles.introSpins}>{spinsAwarded}</span> GOLD SPINS
        </p>
        <motion.button
          className={styles.startBtn}
          onClick={onStart}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
        >
          START
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ── Bonus Summary Modal ──────────────────────────────────────────────
interface BonusSummaryModalProps {
  totalWin: number;
  bet: number;
  onDismiss: () => void;
}

export function BonusSummaryModal({ totalWin, bet, onDismiss }: BonusSummaryModalProps) {
  const multiplier = bet > 0 ? totalWin / bet : 0;

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onDismiss}
    >
      <motion.div
        className={styles.summaryPanel}
        initial={{ scale: 0.72, y: 50, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.88, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.summaryBurst}>🏆</div>
        <p className={styles.summaryLabel}>BONUS COMPLETE</p>
        <p className={styles.summaryWin}>${totalWin.toFixed(2)}</p>
        <p className={styles.summaryMult}>{multiplier.toFixed(1)}× bet</p>
        <motion.button
          className={styles.collectBtn}
          onClick={onDismiss}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
        >
          COLLECT
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSpinPlayer, FEATURE_MODES } from '../hooks/useSpinPlayer';
import { Grid } from './Grid';
import { SlotControls } from './SlotControls';
import { FeatureBuyModal } from './FeatureBuyModal';
import { BonusIntroModal, BonusSummaryModal } from './BonusModals';
import styles from './SlotMachine.module.css';

interface SlotMachineProps {
  initialBalance: number;
}

export function SlotMachine({ initialBalance }: SlotMachineProps) {
  const {
    state, spin, setBet, setFeatureMode, setActiveBooster, setAutoSpins,
    confirmBonusStart, dismissBonusSummary,
  } = useSpinPlayer(initialBalance);

  const {
    displayGrid, glowCells, newCells, specialCells,
    isSpinning, isPlaying, isClearing, spinGen,
    balance, bet, totalWin, bonusState, spinLabel, error,
    featureMode, activeBooster, autoSpinsRemaining, gsStats,
    pendingBonusModal, bonusSummary,
  } = state;

  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const busy = isSpinning || isPlaying;

  function handleBuyAndSpin(key: string) {
    setFeatureMode(key);
    setTimeout(spin, 0);
    setBuyModalOpen(false);
  }

  return (
    <div className={styles.wrapper}>

      {/* ── Bonus banner ───────────────────────────────────────── */}
      <AnimatePresence>
        {bonusState.active && (
          <motion.div
            className={styles.bonusBanner}
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
          >
            ⭐ GOLD SPINS — {bonusState.spinsRemaining} / {bonusState.totalSpins} remaining
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Spin label (WIN!, STEAM!, etc.) ────────────────────── */}
      <div className={styles.labelRow}>
        <AnimatePresence mode="wait">
          {spinLabel && (
            <motion.span
              key={spinLabel}
              className={styles.spinLabel}
              initial={{ opacity: 0, y: -8, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
            >
              {spinLabel}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* ── Main grid ──────────────────────────────────────────── */}
      <Grid
        grid={displayGrid}
        glowCells={glowCells}
        newCells={newCells}
        specialCells={specialCells}
        isExiting={isClearing}
        spinGen={spinGen}
      />

      {/* ── Session stats strip ────────────────────────────────── */}
      <div className={styles.statsStrip}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Spins</span>
          <span className={styles.statVal}>{gsStats.totalSpins}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>XP</span>
          <span className={styles.statVal}>{gsStats.xp.toFixed(1)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Wagered</span>
          <span className={styles.statVal}>${gsStats.totalWagered.toFixed(2)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Won</span>
          <span className={`${styles.statVal} ${styles.statValWon}`}>${gsStats.totalWon.toFixed(2)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Best Win</span>
          <span className={`${styles.statVal} ${styles.statValBest}`}>
            {gsStats.biggestWin > 0 ? `$${gsStats.biggestWin.toFixed(2)}` : '—'}
          </span>
        </div>
      </div>

      {/* ── Control bar ────────────────────────────────────────── */}
      <SlotControls
        balance={balance}
        bet={bet}
        totalWin={totalWin}
        featureMode={featureMode}
        activeBooster={activeBooster}
        autoSpinsRemaining={autoSpinsRemaining}
        isBonus={bonusState.active}
        busy={busy}
        onSpin={spin}
        onSetBet={setBet}
        onSetAutoSpins={setAutoSpins}
        onClearFeature={() => setFeatureMode(null)}
        onClearBooster={() => setActiveBooster(null)}
        onOpenBuyModal={() => setBuyModalOpen(true)}
      />

      {/* ── Error message ──────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            className={styles.error}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Feature Buy Modal ───────────────────────────────────── */}
      <FeatureBuyModal
        open={buyModalOpen}
        bet={bet}
        balance={balance}
        onClose={() => setBuyModalOpen(false)}
        onSetBet={setBet}
        onSelect={key => {
          // Bonus buys are one-shot; boosters persist across spins
          if (FEATURE_MODES[key]?.section === 'bonus') setFeatureMode(key);
          else setActiveBooster(key);
        }}
        onBuyAndSpin={handleBuyAndSpin}
      />

      {/* ── Bonus Intro Modal ───────────────────────────────────── */}
      <AnimatePresence>
        {pendingBonusModal && (
          <BonusIntroModal
            spinsAwarded={pendingBonusModal.spinsAwarded}
            onStart={confirmBonusStart}
          />
        )}
      </AnimatePresence>

      {/* ── Bonus Summary Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {bonusSummary && (
          <BonusSummaryModal
            totalWin={bonusSummary.totalWin}
            bet={bet}
            onDismiss={dismissBonusSummary}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

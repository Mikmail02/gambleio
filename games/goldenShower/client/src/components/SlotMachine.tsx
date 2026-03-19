import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSpinPlayer, FEATURE_MODES } from '../hooks/useSpinPlayer';
import { useAudio } from '../hooks/useAudio';
import { Grid } from './Grid';
import { SlotControls } from './SlotControls';
import { FeatureBuyModal } from './FeatureBuyModal';
import { BonusIntroModal, BonusSummaryModal } from './BonusModals';
import { BonusTracker } from './BonusTracker';
import styles from './SlotMachine.module.css';

interface SlotMachineProps {
  initialBalance: number;
}

export function SlotMachine({ initialBalance }: SlotMachineProps) {
  const {
    state, spin, setBet, setFeatureMode, setActiveBooster, setAutoSpins,
    confirmBonusStart: confirmBonusStartBase, dismissBonusSummary: dismissBonusSummaryBase,
  } = useSpinPlayer(initialBalance);

  const { switchToBonus, switchToBase, volume, setVolume, toggleMute } = useAudio();

  function confirmBonusStart() {
    switchToBonus();
    confirmBonusStartBase();
  }

  function dismissBonusSummary() {
    switchToBase();
    dismissBonusSummaryBase();
  }

  const {
    displayGrid, glowCells, newCells, specialCells,
    isSpinning, isPlaying, isClearing, spinGen,
    balance, bet, totalWin, bonusState, spinLabel, error,
    featureMode, activeBooster, autoSpinsRemaining,
    pendingBonusModal, bonusSummary,
    hiddenCols, bonusRetriggerCells, sessionProfit, sessionStats,
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
    <div className={styles.contentCol}>

      {/* ── Back button ──────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => {
          // When embedded in the main site's iframe, notify the parent to navigate back.
          // When opened standalone (direct URL), fall back to browser history.
          if (window.parent !== window) {
            window.parent.postMessage({ type: 'gs:back' }, window.location.origin);
          } else {
            window.history.back();
          }
        }}>
          ← Back
        </button>
        <span className={styles.gameTitle}>Golden Shower</span>
        <div className={styles.topBarSpacer} />
      </div>

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

      {/* ── Grid + Bonus Tracker side by side ──────────────────── */}
      <div className={styles.gridRow}>
        <Grid
          grid={displayGrid}
          glowCells={glowCells}
          newCells={newCells}
          specialCells={specialCells}
          hiddenCols={hiddenCols}
          bonusRetriggerCells={bonusRetriggerCells}
          isExiting={isClearing}
          spinGen={spinGen}
        />
        <BonusTracker bonusState={bonusState} />
      </div>

      {/* ── Session stats strip (resets each page load) ───────── */}
      <div className={styles.statsStrip}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Spins</span>
          <span className={styles.statVal}>{sessionStats.totalSpins}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>XP</span>
          <span className={styles.statVal}>{sessionStats.xp.toFixed(1)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Wagered</span>
          <span className={styles.statVal}>${sessionStats.totalWagered.toFixed(2)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Won</span>
          <span className={`${styles.statVal} ${styles.statValWon}`}>${sessionStats.totalWon.toFixed(2)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Profit</span>
          <span className={`${styles.statVal} ${sessionProfit >= 0 ? styles.statValWon : styles.statValLoss}`}>
            {sessionProfit >= 0 ? '+' : ''}${sessionProfit.toFixed(2)}
          </span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Best Win</span>
          <span className={`${styles.statVal} ${styles.statValBest}`}>
            {sessionStats.biggestWin > 0 ? `$${sessionStats.biggestWin.toFixed(2)}` : '—'}
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
        volume={volume}
        onSpin={spin}
        onSetBet={setBet}
        onSetAutoSpins={setAutoSpins}
        onClearFeature={() => setFeatureMode(null)}
        onClearBooster={() => setActiveBooster(null)}
        onOpenBuyModal={() => setBuyModalOpen(true)}
        onSetVolume={setVolume}
        onToggleMute={toggleMute}
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

    </div>{/* /contentCol */}

      {/* ── Feature Buy Modal ───────────────────────────────────── */}
      <FeatureBuyModal
        open={buyModalOpen}
        bet={bet}
        balance={balance}
        onClose={() => setBuyModalOpen(false)}
        onSetBet={setBet}
        onSelect={key => {
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

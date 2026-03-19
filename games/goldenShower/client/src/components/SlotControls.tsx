import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BET_OPTIONS } from '../constants';
import { FEATURE_MODES } from '../hooks/useSpinPlayer';
import styles from './SlotControls.module.css';

// ── Inline speaker SVG icons (4 states) ───────────────────────────
function SpeakerIcon({ volume }: { volume: number }) {
  const base = (
    // Speaker body — same for all states
    <path
      d="M3 9v6h4l5 5V4L7 9H3z"
      fill="currentColor"
    />
  );

  if (volume === 0) {
    // Muted: speaker body + X
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {base}
        <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (volume <= 0.33) {
    // Low: speaker body + 1 small arc
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {base}
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  if (volume <= 0.66) {
    // Medium: speaker body + 2 arcs
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {base}
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        <path d="M18.36 5.64a9 9 0 0 1 0 12.73" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  // Max: speaker body + 3 arcs
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {base}
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M18.36 5.64a9 9 0 0 1 0 12.73" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M21.19 2.81a13 13 0 0 1 0 18.38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const AUTO_SPIN_OPTIONS = [5, 10, 25, 50, 100];

interface SlotControlsProps {
  balance: number;
  bet: number;
  totalWin: number;
  featureMode: string | null;
  activeBooster: string | null;
  autoSpinsRemaining: number;
  isBonus: boolean;
  busy: boolean;
  volume: number;
  onSpin: () => void;
  onSetBet: (bet: number) => void;
  onSetAutoSpins: (n: number) => void;
  onClearFeature: () => void;
  onClearBooster: () => void;
  onOpenBuyModal: () => void;
  onSetVolume: (v: number) => void;
  onToggleMute: () => void;
}

export function SlotControls({
  balance, bet, totalWin, featureMode, activeBooster, autoSpinsRemaining,
  isBonus, busy, volume, onSpin, onSetBet, onSetAutoSpins, onClearFeature, onClearBooster,
  onOpenBuyModal, onSetVolume, onToggleMute,
}: SlotControlsProps) {
  const [autoOpen, setAutoOpen] = useState(false);

  const betIdx      = BET_OPTIONS.indexOf(bet);
  const canDecrease = betIdx > 0;
  const canIncrease = betIdx < BET_OPTIONS.length - 1;

  const featureDef  = featureMode    ? FEATURE_MODES[featureMode]    : null;
  const boosterDef  = activeBooster  ? FEATURE_MODES[activeBooster]  : null;
  const isAutoSpinning = autoSpinsRemaining > 0;
  const hasBooster  = !!activeBooster;

  function stepBet(dir: 1 | -1) {
    const next = BET_OPTIONS[betIdx + dir];
    if (next !== undefined) onSetBet(next);
  }

  function handleAutoClick() {
    if (isAutoSpinning) {
      onSetAutoSpins(0);
    } else {
      setAutoOpen(o => !o);
    }
  }

  function handleAutoOption(n: number) {
    setAutoOpen(false);
    onSetAutoSpins(n);
    onSpin();
  }

  return (
    <div className={styles.bar}>

      {/* ── Left cluster: balance + win ─────────────────────── */}
      <div className={styles.statsCluster}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Balance</span>
          <span className={styles.statValue}>${balance.toFixed(2)}</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statLabel}>Total Win</span>
          <AnimatePresence mode="wait">
            {totalWin > 0 ? (
              <motion.span
                key={totalWin.toFixed(3)}
                className={`${styles.statValue} ${styles.winValue}`}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 18 }}
              >
                ${(totalWin * bet).toFixed(2)}
              </motion.span>
            ) : (
              <span key="zero" className={styles.statValue}>—</span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Volume control ──────────────────────────────────── */}
      <div className={styles.volumeCluster}>
        <button
          className={`${styles.muteBtn} ${volume === 0 ? styles.muteBtnMuted : ''}`}
          onClick={onToggleMute}
          title={volume === 0 ? 'Unmute music' : 'Mute music'}
          aria-label={volume === 0 ? 'Unmute music' : 'Mute music'}
        >
          <SpeakerIcon volume={volume} />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={e => onSetVolume(Number(e.target.value))}
          className={styles.volumeSlider}
          aria-label="Music volume"
        />
      </div>

      {/* ── Center: bet selector ────────────────────────────── */}
      <div className={styles.betCluster}>
        <button
          className={styles.betStep}
          onClick={() => stepBet(-1)}
          disabled={busy || !canDecrease}
          aria-label="Decrease bet"
        >−</button>

        <div className={styles.betDisplay}>
          <span className={styles.betLabel}>Bet</span>
          <span className={styles.betAmount}>${bet.toFixed(2)}</span>
        </div>

        <button
          className={styles.betStep}
          onClick={() => stepBet(1)}
          disabled={busy || !canIncrease}
          aria-label="Increase bet"
        >+</button>
      </div>

      {/* ── Right cluster: badges, buy, auto, spin ──────────── */}
      <div className={styles.actionCluster}>

        {/* One-shot feature badge */}
        <AnimatePresence>
          {featureMode && featureDef && (
            <motion.button
              className={styles.featureBadge}
              onClick={onClearFeature}
              title="Click to clear feature"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              {featureDef.label}
              <span className={styles.badgeX}>✕</span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Active booster badge */}
        <AnimatePresence>
          {activeBooster && boosterDef && (
            <motion.button
              className={styles.boosterBadge}
              onClick={onClearBooster}
              title="Click to clear booster"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              🔥 BOOST ACTIVE
              <span className={styles.badgeX}>✕</span>
            </motion.button>
          )}
        </AnimatePresence>

        {/* BUY BONUS — prominent rectangular button */}
        <button
          className={styles.buyBonusBtn}
          onClick={onOpenBuyModal}
          disabled={busy || isBonus}
          title="Buy Feature"
        >
          <span className={styles.buyBonusIcon}>🎰</span>
          <span className={styles.buyBonusLabel}>BUY<br />BONUS</span>
        </button>

        {/* Auto-spin — single click, dropdown controlled by state */}
        <div className={styles.autoSpinWrapper}>
          <button
            className={`${styles.autoBtn} ${isAutoSpinning ? styles.autoBtnActive : ''}`}
            onClick={handleAutoClick}
            disabled={busy && !isAutoSpinning}
            title={isAutoSpinning ? 'Stop auto-spin' : 'Auto-spin'}
          >
            {isAutoSpinning ? (
              <>
                <span className={styles.autoCount}>{autoSpinsRemaining}</span>
                <span className={styles.autoLabel}>Stop</span>
              </>
            ) : (
              <>
                <span className={styles.autoIcon}>↺</span>
                <span className={styles.autoLabel}>Auto</span>
              </>
            )}
          </button>

          <AnimatePresence>
            {autoOpen && !isAutoSpinning && (
              <motion.div
                className={styles.autoDropdown}
                initial={{ opacity: 0, y: 8, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.94 }}
                transition={{ duration: 0.13 }}
              >
                {AUTO_SPIN_OPTIONS.map(n => (
                  <button
                    key={n}
                    className={styles.autoOption}
                    onClick={() => handleAutoOption(n)}
                    disabled={busy}
                  >
                    {n}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Main spin button */}
        <motion.button
          className={[
            styles.spinBtn,
            isBonus    ? styles.spinBtnBonus   : '',
            hasBooster ? styles.spinBtnBooster : '',
            featureMode && !hasBooster && !isBonus ? styles.spinBtnFeature : '',
          ].join(' ')}
          onClick={onSpin}
          disabled={busy}
          whileTap={{ scale: 0.93 }}
          animate={busy ? { opacity: 0.55 } : { opacity: 1 }}
        >
          {isAutoSpinning
            ? '●'
            : busy
              ? '◌'
              : isBonus
                ? '⭐'
                : hasBooster
                  ? '🔥'
                  : featureMode
                    ? '▶'
                    : '◉'}
        </motion.button>

      </div>
    </div>
  );
}

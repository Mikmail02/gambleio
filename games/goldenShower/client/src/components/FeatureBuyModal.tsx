import { motion, AnimatePresence } from 'framer-motion';
import { BET_OPTIONS } from '../constants';
import { FEATURE_MODES, type FeatureModeDef } from '../hooks/useSpinPlayer';
import styles from './FeatureBuyModal.module.css';

// Per-feature display config
const FEATURE_DISPLAY: Record<string, { icon: string; accentColor: string; tag?: string }> = {
  BONUS_3:        { icon: '🎰', accentColor: '#f5c518', tag: '6 FREE SPINS' },
  BONUS_4:        { icon: '🎰', accentColor: '#ff8c00', tag: '8 FREE SPINS' },
  BONUS_5:        { icon: '🎰', accentColor: '#e34234', tag: '10 FREE SPINS' },
  MYSTERY_BONUS:  { icon: '🃏', accentColor: '#a855f7', tag: 'RANDOM' },
  BONUS_HUNT:     { icon: '🔍', accentColor: '#22d3ee', tag: '2× BET' },
  STEAMY_SPIN:    { icon: '💨', accentColor: '#60a5fa', tag: '×16 START' },
  STEAMIER_SPIN:  { icon: '🌊', accentColor: '#f97316', tag: '×64 START' },
  STEAMIEST_SPIN: { icon: '⚡', accentColor: '#ffe040', tag: '×128 + DRAIN' },
};

interface FeatureBuyModalProps {
  open: boolean;
  bet: number;
  balance: number;
  onClose: () => void;
  onSetBet: (bet: number) => void;
  onSelect: (featureModeKey: string) => void;
  onBuyAndSpin: (featureModeKey: string) => void;
}

interface FeatureCardProps {
  featureKey: string;
  def: FeatureModeDef;
  bet: number;
  balance: number;
  onSelect: () => void;
  onBuyAndSpin: (e: React.MouseEvent) => void;
}

function FeatureCard({ featureKey, def, bet, balance, onSelect, onBuyAndSpin }: FeatureCardProps) {
  const display  = FEATURE_DISPLAY[featureKey];
  const cost     = Math.round(bet * def.costMultiplier * 100) / 100;
  const canAfford = balance >= cost;

  return (
    <motion.div
      className={styles.card}
      style={{ '--accent': display.accentColor } as React.CSSProperties}
      onClick={onSelect}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onSelect()}
    >
      <div className={styles.cardIcon}>{display.icon}</div>

      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>{def.label}</span>
          {display.tag && <span className={styles.cardTag}>{display.tag}</span>}
        </div>
        <p className={styles.cardDesc}>{def.description}</p>
      </div>

      <div className={styles.cardFooter}>
        <div className={styles.costBlock}>
          <span className={styles.costLabel}>{def.costMultiplier}× bet</span>
          <span className={`${styles.costAmount} ${!canAfford ? styles.costCantAfford : ''}`}>
            ${cost.toFixed(2)}
          </span>
        </div>

        <button
          className={`${styles.buyBtn} ${!canAfford ? styles.buyBtnDisabled : ''}`}
          onClick={onBuyAndSpin}
          disabled={!canAfford}
        >
          Buy &amp; Spin
        </button>
      </div>
    </motion.div>
  );
}

export function FeatureBuyModal({ open, bet, balance, onClose, onSetBet, onSelect, onBuyAndSpin }: FeatureBuyModalProps) {
  const bonusKeys   = Object.keys(FEATURE_MODES).filter(k => FEATURE_MODES[k].section === 'bonus');
  const boosterKeys = Object.keys(FEATURE_MODES).filter(k => FEATURE_MODES[k].section === 'booster');

  const betIdx      = BET_OPTIONS.indexOf(bet);
  const canDecrease = betIdx > 0;
  const canIncrease = betIdx < BET_OPTIONS.length - 1;

  function stepBet(dir: 1 | -1) {
    const next = BET_OPTIONS[betIdx + dir];
    if (next !== undefined) onSetBet(next);
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className={styles.modal}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 340, damping: 26 }}
          >
            {/* Header */}
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                <h2 className={styles.title}>BONUS BUY</h2>
              </div>

              {/* Bet selector inside modal header */}
              <div className={styles.betSelector}>
                <button
                  className={styles.betStep}
                  onClick={() => stepBet(-1)}
                  disabled={!canDecrease}
                  aria-label="Decrease bet"
                >−</button>
                <div className={styles.betDisplay}>
                  <span className={styles.betLabel}>Bet</span>
                  <span className={styles.betAmount}>${bet.toFixed(2)}</span>
                </div>
                <button
                  className={styles.betStep}
                  onClick={() => stepBet(1)}
                  disabled={!canIncrease}
                  aria-label="Increase bet"
                >+</button>
              </div>

              <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
            </div>

            <div className={styles.scrollBody}>
              {/* Bonus Buys section */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Bonus Buys</h3>
                <div className={styles.cardGrid}>
                  {bonusKeys.map(key => (
                    <FeatureCard
                      key={key}
                      featureKey={key}
                      def={FEATURE_MODES[key]}
                      bet={bet}
                      balance={balance}
                      onSelect={() => { onSelect(key); onClose(); }}
                      onBuyAndSpin={e => { e.stopPropagation(); onBuyAndSpin(key); onClose(); }}
                    />
                  ))}
                </div>
              </div>

              {/* Feature Spins section */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Feature Spins</h3>
                <div className={styles.cardGrid}>
                  {boosterKeys.map(key => (
                    <FeatureCard
                      key={key}
                      featureKey={key}
                      def={FEATURE_MODES[key]}
                      bet={bet}
                      balance={balance}
                      onSelect={() => { onSelect(key); onClose(); }}
                      onBuyAndSpin={e => { e.stopPropagation(); onBuyAndSpin(key); onClose(); }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

import { SlotMachine } from './components/SlotMachine';

/**
 * Read the player's balance from the host app's localStorage key.
 * Falls back to 0 if the key is absent (e.g. logged-out dev session).
 */
function readBalance(): number {
  try {
    const raw = localStorage.getItem('gambleio_user');
    if (!raw) return 0;
    const user = JSON.parse(raw);
    return Number(user?.balance) || 0;
  } catch {
    return 0;
  }
}

export default function App() {
  return <SlotMachine initialBalance={readBalance()} />;
}

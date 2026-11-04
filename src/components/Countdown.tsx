import { useNow } from '../lib/api';
import { fmtAgo, fmtDur } from '../lib/format';

/**
 * Ticking leaves: only these small components re-render every second, so the rest of the tree
 * can work from a coarse clock (or none at all).
 */

/** Time left until `at` (epoch ms). */
export function Countdown({ at }: { at: number }) {
  const now = useNow(1000);
  return <>{fmtDur(at - now)}</>;
}

/** Time since `since` (epoch ms), e.g. "5m ago". */
export function Ago({ since }: { since: number }) {
  const now = useNow(1000);
  return <>{fmtAgo(now - since)}</>;
}

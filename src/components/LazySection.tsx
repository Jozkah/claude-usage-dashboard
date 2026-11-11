import type { ReactNode } from 'react';
import { useNearViewport } from '../lib/scroll';

/**
 * Mounts its children only once they are about to scroll into view (and keeps them mounted).
 * Until then it reserves `minHeight`, so the page does not jump when the content appears and nothing below the
 * fold is fetched or drawn early.
 */
export function LazySection({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(700);
  return <div ref={ref} style={near ? undefined : { minHeight }}>{near ? children : null}</div>;
}

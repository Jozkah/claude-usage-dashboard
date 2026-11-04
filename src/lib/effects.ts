import { useCallback, useEffect, useState } from 'react';

const KEY = 'cud-effects';

function saved(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch { return null; }
}

/** Decorative motion (aurora glow, border beam, pulsing dots, blur). Off by default under reduced motion. */
export function useEffectsPref() {
  const [on, setOn] = useState(() => saved() ?? !matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => { document.documentElement.classList.toggle('no-fx', !on); }, [on]);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch { /* private mode */ }
  }, [on]);
  return { on, toggle };
}

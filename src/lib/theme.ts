import { useCallback, useEffect, useState } from 'react';

const THEME_COLORS = { light: '#f8f8f8', dark: '#09090b' };

function apply(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLORS.dark : THEME_COLORS.light);
}

function saved(): 'dark' | 'light' | null {
  try {
    const t = localStorage.getItem('cud-theme');
    return t === 'dark' || t === 'light' ? t : null;
  } catch { return null; }
}

export function useTheme() {
  const [dark, setDark] = useState(() => {
    const t = saved();
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // keep the DOM (class + theme-color meta) in step with state
  useEffect(() => { apply(dark); }, [dark]);

  // follow OS changes until the user picks a theme explicitly
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => { if (!saved()) setDark(e.matches); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    try { localStorage.setItem('cud-theme', next ? 'dark' : 'light'); } catch { /* private mode */ }
  }, [dark]);
  return { dark, toggle };
}

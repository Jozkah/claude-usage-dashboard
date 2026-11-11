import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * True once the element has come within `margin` px of the viewport (and stays true). Without IntersectionObserver
 * it is true immediately, so nothing stays hidden.
 */
export function useNearViewport<T extends Element>(margin = 600) {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const seen = useRef(near);
  const ref = useCallback((el: T | null) => {
    if (!el || seen.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { seen.current = true; setNear(true); io.disconnect(); }
    }, { rootMargin: `${margin}px 0px` });
    io.observe(el);
  }, [margin]);
  return [ref, near] as const;
}

const KEY = 'cud-scroll';

/** Remembers the scroll position across reloads and puts it back once the page has its content. */
export function useScrollRestore(ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // content arrives late; the browser would restore too early
    const save = () => { try { sessionStorage.setItem(KEY, String(Math.round(window.scrollY))); } catch { /* private mode */ } };
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, []);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    if (location.hash.length > 1) { // an explicit anchor wins; its section only exists once the data has arrived
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'auto' }));
      return;
    }
    let y = 0;
    try { y = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* private mode */ }
    if (y > 0) requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
  }, [ready]);
}

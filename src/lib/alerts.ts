import { useCallback, useEffect, useRef, useState } from 'react';
import type { Account } from './types';
import { levelFor } from './format';

const KEY = 'cud-notify';
const THRESHOLD = 85;
const BASE_TITLE = 'Claude usage';
const FILL = { good: '#059669', warn: '#d97706', bad: '#ef4444' };

function favicon(color: string) {
  return 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#1f2937"/>` +
    `<path d="M8.5 21a8.5 8.5 0 1 1 15 0" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M8.5 21a8.5 8.5 0 0 1 9-8.3" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="16" cy="21" r="2" fill="#fff"/><circle cx="25" cy="7" r="5" fill="${color}"/></svg>`,
  );
}

/** Opt-in desktop notifications, persisted in localStorage. */
export function useNotifyPref() {
  const supported = typeof Notification !== 'undefined';
  const [enabled, setEnabled] = useState(() => {
    try { return supported && localStorage.getItem(KEY) === '1' && Notification.permission === 'granted'; } catch { return false; }
  });
  const toggle = useCallback(async () => {
    if (!supported) return;
    if (enabled) {
      setEnabled(false);
      try { localStorage.setItem(KEY, '0'); } catch { /* private mode */ }
      return;
    }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm === 'granted') {
      setEnabled(true);
      try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    }
  }, [enabled, supported]);
  return { supported, enabled, toggle };
}

/** Puts the tightest limit in the tab title, tints the favicon, and optionally notifies on threshold crossings. */
export function useAlerts(accounts: Account[], notify: boolean) {
  const prev = useRef(new Map<string, number>());
  const lastIcon = useRef('');

  useEffect(() => {
    let top: number | null = null;
    for (const a of accounts) {
      if (a.status !== 'ok') continue;
      for (const w of a.windows ?? []) if (top == null || w.used > top) top = w.used;
    }
    document.title = top == null ? BASE_TITLE : `${Math.round(top)}% - ${BASE_TITLE}`;

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const href = top != null && top >= 60 ? favicon(FILL[levelFor(top)]) : '/favicon.svg';
    if (link && href !== lastIcon.current) { link.href = href; lastIcon.current = href; }

    const seen = prev.current;
    for (const a of accounts) {
      if (a.status !== 'ok') continue;
      for (const w of a.windows ?? []) {
        const id = `${a.id}:${w.key}`;
        const before = seen.get(id);
        seen.set(id, w.used);
        if (!notify || before == null || typeof Notification === 'undefined' || Notification.permission !== 'granted') continue;
        if (before < THRESHOLD && w.used >= THRESHOLD) new Notification(`${a.name}: ${w.label} at ${Math.round(w.used)}%`);
        else if (before >= THRESHOLD && w.used < before - 30) new Notification(`${a.name}: ${w.label} reset`, { body: `Now at ${Math.round(w.used)}%` });
      }
    }
  }, [accounts, notify]);
}

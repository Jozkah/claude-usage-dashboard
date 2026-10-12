import type { Account, Level, UsageWindow } from './types';

export const levelFor = (used: number): Level => (used >= 85 ? 'bad' : used >= 60 ? 'warn' : 'good');
export const colorVar = (l: Level) => `var(--${l})`;

export function windowLength(key: string): number | null {
  if (key === 'five_hour') return 5 * 3600e3;
  if (key.startsWith('seven_day')) return 7 * 864e5;
  return null;
}

/** 0..1 share of the window that has already passed, or null if unknown. */
export function elapsedFraction(w: UsageWindow, now: number): number | null {
  const len = windowLength(w.key);
  if (!len || !w.resetsAt) return null;
  const left = new Date(w.resetsAt).getTime() - now;
  const e = 1 - left / len;
  return e >= 0 && e <= 1 ? e : null;
}

export type Pace = { label: string; tone: Level | 'mute' } | null;

export function paceFor(w: UsageWindow, now: number): Pace {
  const e = elapsedFraction(w, now);
  if (e == null || e < 0.03) return null;
  const diff = w.used - e * 100;
  if (diff > 12) return { label: 'Burning fast', tone: 'bad' };
  if (diff < -12) return { label: 'Room to spare', tone: 'good' };
  return { label: 'On pace', tone: 'mute' };
}

export function fmtDur(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function fmtClock(ts: number | string): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

/** Percentage points left on the tightest of the two main windows. */
export function headroom(a: Account): number {
  const ws = a.windows ?? [];
  const main = ws.filter((w) => w.key === 'five_hour' || w.key === 'seven_day');
  const use = main.length ? main : ws;
  if (!use.length) return 0;
  return Math.min(...use.map((w) => 100 - w.used));
}

export function mainWindows(a: Account): UsageWindow[] {
  const ws = a.windows ?? [];
  const main = ws.filter((w) => w.key === 'five_hour' || w.key === 'seven_day');
  return main.length ? main : ws.slice(0, 2);
}

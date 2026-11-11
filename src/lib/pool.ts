import type { Account, UsageWindow } from './types';
import { paceBand } from './pace.ts';

/** Length of the windows whose reset time is known (same rule as format.ts, kept local so tests can import this file alone). */
const windowLength = (key: string, lengthMs?: number): number | null =>
  lengthMs && lengthMs > 0 ? lengthMs : key === 'five_hour' ? 5 * 36e5 : key.startsWith('seven_day') ? 7 * 864e5 : key === 'monthly' ? 30 * 864e5 : null;

export interface Segment {
  account: Account;
  w: UsageWindow | null;
  /** Percent left in this account's window, null when there is no live reading. */
  left: number | null;
  /** Share (0..1) of the window that has passed, null when unknown. */
  elapsed: number | null;
  resetAt: number | null;
}

export interface PoolRow {
  key: string;
  label: string;
  segments: Segment[];
  /** Mean percent left over the accounts that have a reading. */
  left: number | null;
  /** Mean share of the window that has passed. */
  elapsed: number | null;
  /** Percent that comes back at the next reset (what has been used, pooled). */
  refill: number | null;
  /** Milliseconds until the soonest reset. */
  resetIn: number | null;
  pace: { label: string; tone: 'good' | 'mute' | 'bad' } | null;
}

export interface PoolGroup { provider: string; rows: PoolRow[] }

const ORDER = ['five_hour', 'seven_day', 'monthly'];
const rowLabel = (key: string, w: UsageWindow) =>
  key === 'five_hour' ? 'Session' : key === 'seven_day' ? 'Weekly' : key === 'monthly' ? 'Monthly' : w.label.replace(/\s*·\s*all models$/i, '') || key;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Groups accounts by provider and pools each limit across them: one bar per limit, one segment per account.
 * An account without a live reading for a limit still gets an (empty) segment so the row lines up.
 */
export function poolLimits(accounts: Account[], providerOf: (a: Account) => string, now: number): PoolGroup[] {
  const byProvider = new Map<string, Account[]>();
  for (const a of accounts) {
    const p = providerOf(a);
    byProvider.set(p, [...(byProvider.get(p) ?? []), a]);
  }
  const groups: PoolGroup[] = [];
  for (const [provider, list] of byProvider) {
    const keys = new Map<string, UsageWindow>();
    for (const a of list) {
      if (a.status !== 'ok') continue;
      for (const w of a.windows ?? []) if (!w.expired && !keys.has(w.key)) keys.set(w.key, w);
    }
    const rows: PoolRow[] = [...keys.entries()]
      .sort(([a], [b]) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      })
      .map(([key, sample]) => {
        const len = windowLength(key, sample.lengthMs);
        const segments: Segment[] = list.map((account) => {
          const w = account.status === 'ok' ? (account.windows ?? []).find((x) => x.key === key && !x.expired) ?? null : null;
          const resetAt = w?.resetsAt ? Date.parse(w.resetsAt) : null;
          const ok = resetAt != null && Number.isFinite(resetAt);
          const elapsed = w && ok && len ? Math.min(1, Math.max(0, 1 - (resetAt! - now) / len)) : null;
          return { account, w, left: w ? Math.max(0, Math.min(100, 100 - w.used)) : null, elapsed, resetAt: ok ? resetAt : null };
        });
        const lefts = segments.flatMap((s) => (s.left == null ? [] : [s.left]));
        const left = mean(lefts);
        // pace is judged only on accounts whose window has a reset clock, so a missing reading cannot skew it
        const timed = segments.flatMap((s) => (s.elapsed == null || s.left == null ? [] : [{ used: 100 - s.left, elapsed: s.elapsed }]));
        const elapsed = mean(timed.map((t) => t.elapsed));
        const resets = segments.flatMap((s) => (s.resetAt == null ? [] : [s.resetAt - now]));
        const resetIn = resets.length ? Math.max(0, Math.min(...resets)) : null;
        let pace: PoolRow['pace'] = null;
        if (elapsed != null && elapsed >= 0.03) pace = paceBand(mean(timed.map((t) => t.used))!, elapsed);
        return { key, label: rowLabel(key, sample), segments, left, elapsed, refill: left == null ? null : 100 - left, resetIn, pace };
      });
    if (rows.length) groups.push({ provider, rows });
  }
  return groups;
}

/** Up to two letters for an account's avatar chip. */
export function initials(name: string): string {
  const words = name.replace(/[()]/g, ' ').split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

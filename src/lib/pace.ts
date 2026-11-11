import type { Level, UsageWindow } from './types';


/** One reading of a window: [time in ms, percent used]. */
export type Pt = [number, number];

/** Length of the windows whose reset time is known (same rule as format.ts, kept here so tests can import this file alone). */
const windowLength = (key: string, lengthMs?: number): number | null =>
  lengthMs && lengthMs > 0 ? lengthMs : key === 'five_hour' ? 5 * 36e5 : key.startsWith('seven_day') ? 7 * 864e5 : key === 'monthly' ? 30 * 864e5 : null;

const DAY = 864e5;
const HOUR = 36e5;

export interface Mark { t: number; used: number | null }
export interface Checkpoints {
  start: number;
  end: number;
  unit: 'day' | 'hour';
  /** Usage at the start (0), at every day (or hour) boundary since, and now. `used` is null where no reading covers the time. */
  marks: Mark[];
  /** Usage since the last boundary, and in the period before it. */
  sinceLast: number | null;
  previous: number | null;
}

/** Usage at time t, from the readings around it (linear between close readings, last known otherwise). */
export function valueAt(points: Pt[], t: number, maxGap = 12 * HOUR): number | null {
  if (!points.length) return null;
  let before: Pt | null = null;
  let after: Pt | null = null;
  for (const p of points) {
    if (p[0] <= t) before = p;
    else { after = p; break; }
  }
  if (!before) return null; // nothing was read before this time
  if (after && after[0] - before[0] <= maxGap && after[0] > before[0]) {
    return before[1] + ((after[1] - before[1]) * (t - before[0])) / (after[0] - before[0]);
  }
  // a reading long before t may belong to an earlier window or be stale
  if (t - before[0] > 12 * HOUR) return null;
  return before[1];
}

/** Local midnights (or hour starts) inside (start, now]. */
function boundaries(start: number, now: number, unit: 'day' | 'hour'): number[] {
  const out: number[] = [];
  const d = new Date(start);
  if (unit === 'day') { d.setHours(24, 0, 0, 0); } else { d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); }
  for (let guard = 0; d.getTime() <= now && guard < 400; guard++) {
    out.push(d.getTime());
    if (unit === 'day') d.setDate(d.getDate() + 1); else d.setHours(d.getHours() + 1);
  }
  return out;
}

/** Where usage stood at each day boundary of the current window, so a day's spend is visible as a block. */
export function checkpoints(points: Pt[], w: UsageWindow, now: number): Checkpoints | null {
  const len = windowLength(w.key, w.lengthMs);
  const end = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
  if (!len || !Number.isFinite(end) || w.expired) return null;
  const start = end - len;
  if (now < start) return null;
  const unit: 'day' | 'hour' = len >= 2 * DAY ? 'day' : 'hour';
  const inWindow = points.filter((p) => p[0] >= start - 15 * 60e3);
  const marks: Mark[] = [{ t: start, used: 0 }];
  for (const b of boundaries(start, now, unit)) marks.push({ t: b, used: valueAt(inWindow, b) });
  marks.push({ t: now, used: w.used });
  // keep marks monotone: a late or stale reading must not make a block negative
  let high = 0;
  for (const m of marks) { if (m.used != null) { m.used = Math.max(high, Math.min(100, m.used)); high = m.used; } }
  const last = marks[marks.length - 2];
  const before = marks[marks.length - 3];
  const sinceLast = last.used == null ? null : Math.max(0, w.used - last.used);
  const previous = last.used == null || before?.used == null ? null : Math.max(0, last.used - before.used);
  return { start, end, unit, marks, sinceLast, previous };
}

export interface PaceInfo {
  label: string;
  detail: string;
  tone: Level | 'mute';
  /** Projected percent used when the window resets, at the current burn rate. */
  projected: number | null;
  /** When usage would hit 100% at the current rate, if that is before the reset. */
  runsOutAt: number | null;
  /** Percent you can still spend per day (weekly) or per hour (short windows) and arrive exactly at the limit. */
  allowance: number | null;
  perUnit: 'day' | 'hour';
  /** Percent used per day (or hour) over the recent past. */
  recentRate: number | null;
}

const fmtLeft = (ms: number) => {
  const h = ms / HOUR;
  if (h >= 48) return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
  if (h >= 1) return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
  return `${Math.max(1, Math.round(h * 60))}m`;
};

/**
 * Pace from how fast you have been spending, not only from how much time has passed.
 * The recent rate (last day for weekly windows, last hour for short ones) is blended with the window average,
 * then projected to the reset. Needs a live window with a known reset.
 */
export function paceInfo(points: Pt[], w: UsageWindow, now: number): PaceInfo | null {
  const len = windowLength(w.key, w.lengthMs);
  const end = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
  if (!len || !Number.isFinite(end) || w.expired || end <= now) return null;
  const start = end - len;
  const elapsed = now - start;
  if (elapsed < len * 0.03) return null;
  const unit: 'day' | 'hour' = len >= 2 * DAY ? 'day' : 'hour';
  const per = unit === 'day' ? DAY : HOUR;
  const remaining = end - now;
  if (w.used >= 100) {
    return { label: 'Limit reached', detail: `Resets in ${fmtLeft(remaining)}`, tone: 'bad', projected: 100, runsOutAt: now, allowance: 0, perUnit: unit, recentRate: null };
  }

  const average = w.used / elapsed; // percent per ms
  const look = unit === 'day' ? DAY : HOUR;
  const then = valueAt(points.filter((p) => p[0] >= start - 15 * 60e3), now - look);
  const span = Math.min(look, elapsed);
  const recent = then == null || span < look / 6 ? null : Math.max(0, w.used - then) / span;
  const rate = recent == null ? average : 0.6 * recent + 0.4 * average;
  const projected = Math.min(999, w.used + rate * remaining);
  const runsOutAt = rate > 0 && w.used + rate * remaining >= 100 ? now + (100 - w.used) / rate : null;
  const allowance = (100 - w.used) / (remaining / per);

  let label: string;
  let tone: PaceInfo['tone'];
  if (runsOutAt && runsOutAt < end - remaining * 0.04) { label = `Runs out in ${fmtLeft(runsOutAt - now)}`; tone = 'bad'; }
  else if (projected >= 90) { label = `Tight, about ${Math.round(Math.min(100, projected))}% by reset`; tone = 'warn'; }
  else if (projected <= 60) { label = `Room to spare, about ${Math.round(projected)}% by reset`; tone = 'good'; }
  else { label = `On pace, about ${Math.round(projected)}% by reset`; tone = 'mute'; }
  const spend = rate * per;
  const detail = `Spending ${spend >= 10 ? Math.round(spend) : spend.toFixed(1)}% per ${unit}. You can spend ${allowance >= 10 ? Math.round(allowance) : allowance.toFixed(1)}% per ${unit} and still last until the reset.`;
  return { label, detail, tone, projected, runsOutAt, allowance, perUnit: unit, recentRate: recent == null ? null : recent * per };
}

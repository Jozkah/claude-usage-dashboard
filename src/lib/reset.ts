import type { UsageWindow } from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function nextReset(window: UsageWindow, now: number, stale = false): { at: number; estimated: boolean } | null {
  const at = window.resetsAt ? new Date(window.resetsAt).getTime() : NaN;
  if (!Number.isFinite(at)) return null;
  if (at > now) return { at, estimated: stale };
  if (!stale || !window.key.startsWith('seven_day')) return null;
  return { at: at + (Math.floor((now - at) / WEEK_MS) + 1) * WEEK_MS, estimated: true };
}

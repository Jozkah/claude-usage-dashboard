const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Wait a little after a reset: the server may still report the old window at the exact instant. */
export const RESET_GRACE_MS = 45 * 1000;

export function nextReset(window, now, stale = false) {
  const at = Date.parse(window?.resetsAt || '');
  if (!Number.isFinite(at)) return null;
  if (at > now) return { at, estimated: Boolean(stale) };
  if (!stale || !String(window.key).startsWith('seven_day')) return null;
  return { at: at + (Math.floor((now - at) / WEEK_MS) + 1) * WEEK_MS, estimated: true };
}

export function nextUsagePollAt(value, now, graceMs = RESET_GRACE_MS) {
  if (!value || value.status !== 'ok' || !Array.isArray(value.windows)) return now;
  // Only reset-bound windows hold polling; extra_usage and others have no reset to wait for.
  const limiting = value.windows.filter((window) => window.used >= 100 && /^(five_hour|seven_day)/.test(String(window.key)));
  if (!limiting.length) return now;
  const resets = limiting.map((window) => nextReset(window, now, value.stale));
  if (resets.some((reset) => !reset)) return now;
  return Math.max(...resets.map((reset) => reset.at)) + graceMs;
}

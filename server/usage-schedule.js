const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function nextReset(window, now, stale = false) {
  const at = Date.parse(window?.resetsAt || '');
  if (!Number.isFinite(at)) return null;
  if (at > now) return { at, estimated: Boolean(stale) };
  if (!stale || !String(window.key).startsWith('seven_day')) return null;
  return { at: at + (Math.floor((now - at) / WEEK_MS) + 1) * WEEK_MS, estimated: true };
}

export function nextUsagePollAt(value, now) {
  if (!value || value.status !== 'ok' || !Array.isArray(value.windows)) return now;
  const limiting = value.windows.filter((window) => window.used >= 100);
  if (!limiting.length) return now;
  const resets = limiting.map((window) => nextReset(window, now, value.stale));
  if (resets.some((reset) => !reset)) return now;
  return Math.max(now, Math.max(...resets.map((reset) => reset.at)) - 15 * 60 * 1000);
}

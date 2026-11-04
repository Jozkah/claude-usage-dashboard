import fs from 'node:fs';
import { visibleUsageWindows } from './plan-limits.js';

/** Cached windows whose reset time has passed no longer describe the current period: flag them. */
function markExpired(windows, now) {
  return windows.map((window) => {
    const at = Date.parse(window?.resetsAt || '');
    return Number.isFinite(at) && at <= now ? { ...window, expired: true } : window;
  });
}

export function createUsageSnapshot(file, { now = Date.now } = {}) {
  let saved = {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) saved = data;
  } catch { /* no saved readings yet */ }

  const write = () => {
    try {
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify(saved));
      fs.renameSync(temp, file);
    } catch { /* best effort if data directory is read-only */ }
  };

  return {
    peek(account) {
      const last = saved[account.id];
      if (!last || last.configDir !== account.configDir || !Array.isArray(last.windows) || !last.windows.length) return null;
      return { id: account.id, name: account.name, configDir: account.configDir,
        fetchedAt: last.fetchedAt, plan: last.plan, windows: markExpired(visibleUsageWindows(last.plan, last.windows), now()), nextPollAt: last.nextPollAt,
        ...(last.seeded && !last.plan ? { planUnknown: true } : {}),
        status: 'ok', stale: true, staleMessage: 'Waiting until reset approaches.' };
    },
    remember(account, value) {
      if (value.status !== 'ok' || !Array.isArray(value.windows) || !value.windows.length) return;
      saved[account.id] = {
        configDir: account.configDir,
        fetchedAt: value.fetchedAt,
        plan: value.plan,
        windows: value.windows,
        nextPollAt: null,
      };
      write();
    },
    deferUntil(account, at) {
      const last = saved[account.id];
      if (!last || last.configDir !== account.configDir || last.nextPollAt === at) return;
      last.nextPollAt = at;
      write();
    },
    /** `plan` is the account's last known plan, so Max accounts hide the five-hour window right away. */
    seedFromHistory(account, history, labels, plan) {
      if (saved[account.id] || !history || typeof history !== 'object') return;
      const windows = [];
      let fetchedAt = 0;
      for (const [key, label] of Object.entries(labels)) {
        const points = history[key];
        const last = Array.isArray(points) ? points.at(-1) : null;
        if (!Array.isArray(last) || !Number.isFinite(last[0]) || !Number.isFinite(last[1])) continue;
        windows.push({ key, label, used: last[1], resetsAt: null });
        fetchedAt = Math.max(fetchedAt, last[0]);
      }
      if (!windows.length) return;
      saved[account.id] = { configDir: account.configDir, fetchedAt, windows, seeded: true, ...(plan ? { plan } : {}) };
      write();
    },
    fallback(account, failed) {
      const last = saved[account.id];
      if (!last || last.configDir !== account.configDir || !Array.isArray(last.windows) || !last.windows.length) return failed;
      return {
        ...failed,
        plan: last.plan,
        fetchedAt: last.fetchedAt,
        windows: markExpired(visibleUsageWindows(last.plan, last.windows), now()),
        nextPollAt: last.nextPollAt,
        ...(last.seeded && !last.plan ? { planUnknown: true } : {}),
        status: 'ok',
        stale: true,
        authStatus: failed.status,
        staleMessage: failed.message || 'Live usage unavailable.',
      };
    },
    forget(id) {
      if (Object.hasOwn(saved, id)) {
        delete saved[id];
        write();
      }
    },
  };
}

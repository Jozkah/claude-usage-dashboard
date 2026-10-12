import fs from 'node:fs';

export function createUsageSnapshot(file) {
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
    remember(account, value) {
      if (value.status !== 'ok' || !Array.isArray(value.windows) || !value.windows.length) return;
      saved[account.id] = {
        configDir: account.configDir,
        fetchedAt: value.fetchedAt,
        plan: value.plan,
        windows: value.windows,
      };
      write();
    },
    seedFromHistory(account, history, labels) {
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
      saved[account.id] = { configDir: account.configDir, fetchedAt, windows };
      write();
    },
    fallback(account, failed) {
      const last = saved[account.id];
      if (!last || last.configDir !== account.configDir || !Array.isArray(last.windows) || !last.windows.length) return failed;
      return {
        ...failed,
        plan: last.plan,
        fetchedAt: last.fetchedAt,
        windows: last.windows,
        status: 'ok',
        stale: true,
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

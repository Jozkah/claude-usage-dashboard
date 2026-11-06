import fs from 'node:fs/promises';
import path from 'node:path';
import { activeSessionState } from './session-activity.js';

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false; // 0 / negative would signal a process group
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e) && e.code === 'EPERM'; }
}

/**
 * Open Claude Code chats per config folder. Claude Code writes <configDir>/sessions/<pid>.json for every
 * running session and touches it while the chat works. Results are cached for ttlMs (one tick) and
 * concurrent callers share one scan, so /api/usage never does per-request sync IO.
 */
export function createSessionReader({ inContainer = false, ttlMs = 3000, staleMs = 24 * 3600e3,
  containerStaleMs = 10 * 60e3, now = Date.now, alive = pidAlive } = {}) {
  const cache = new Map(); // configDir -> { at, value, pending }

  async function scan(configDir) {
    const dir = path.join(configDir, 'sessions');
    let files;
    try { files = (await fs.readdir(dir)).filter((f) => /^\d+\.json$/.test(f)); } catch { return []; }
    const out = [];
    await Promise.all(files.map(async (f) => {
      try {
        const file = path.join(dir, f);
        const mtime = (await fs.stat(file)).mtimeMs;
        const j = JSON.parse(await fs.readFile(file, 'utf8'));
        const state = activeSessionState(j.status);
        if (!state) return;
        const age = now() - mtime;
        // A reused PID must not keep a crashed session alive forever: old files count as dead.
        const live = inContainer ? age < containerStaleMs : age < staleMs && alive(Number(j.pid));
        if (!live) return;
        out.push({
          pid: Number(j.pid),
          id: String(j.sessionId || j.pid),
          name: String(j.name || '').slice(0, 80) || null,
          folder: String(j.cwd || '').split(/[\\/]/).filter(Boolean).pop() || null,
          where: String(j.entrypoint || '').replace(/^claude-/, '') || null,
          startedAt: Number(j.startedAt) || null,
          lastActiveAt: mtime,
          state,
          working: state === 'busy',
        });
      } catch { /* unreadable file: ignore */ }
    }));
    out.sort((a, b) => Number(b.working) - Number(a.working) || b.lastActiveAt - a.lastActiveAt);
    return out;
  }

  return function read(configDir) {
    const hit = cache.get(configDir);
    if (hit && (hit.pending || now() - hit.at < ttlMs)) return hit.pending || Promise.resolve(hit.value);
    const entry = { at: now(), value: hit ? hit.value : [], pending: null };
    entry.pending = scan(configDir).then((value) => {
      entry.value = value; entry.at = now(); entry.pending = null; return value;
    }, () => { entry.pending = null; return entry.value; });
    cache.set(configDir, entry);
    return entry.pending;
  };
}

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * OpenCode Go subscription usage (session, weekly, monthly). The key is the one OpenCode itself stores in its data
 * folder: its database (credential table) or auth.json, with OPENCODE_API_KEY as the last fallback. Endpoint and
 * storage layout follow what t3code (github.com/pingdotgg/t3code) documents; the endpoint is undocumented.
 */
export const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';
export const OPENCODE_TIMEOUT_MS = 20_000;
const CONSOLE = 'https://opencode.ai/console';

/** A stored key row of OpenCode's database, or null when it is not a key for the hosted service. */
export function parseStoredKey(value) {
  let j;
  try { j = JSON.parse(value); } catch { return null; }
  if (!j || j.type !== 'key' || typeof j.key !== 'string' || !j.key.trim()) return null;
  const server = j.metadata && j.metadata.server;
  if (typeof server === 'string') {
    try {
      const u = new URL(server);
      if (`${u.origin}${u.pathname.replace(/\/+$/, '')}` !== CONSOLE) return null; // another server's key never goes to opencode.ai
    } catch { return null; }
  }
  return j.key.trim();
}

async function readDatabaseKeys(dir) {
  const file = path.join(dir, 'opencode.db');
  try { await fs.access(file); } catch { return []; }
  /** @type {any} */
  let DatabaseSync;
  const sqlite = 'node:sqlite'; // variable specifier: older Node versions lack it
  try { ({ DatabaseSync } = await import(sqlite)); } catch { return []; }
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 200');
    const out = [];
    for (const id of ['opencode', 'opencode-go']) {
      const row = db.prepare('SELECT value FROM credential WHERE integration_id = ? AND active IS NOT 0 ORDER BY active DESC, time_created DESC, id DESC LIMIT 1').get(id);
      const key = typeof row?.value === 'string' ? parseStoredKey(row.value) : null;
      if (key) out.push(key);
    }
    return out;
  } catch { return []; } finally { try { db?.close(); } catch { /* ignore */ } }
}

/** Candidate keys in the order they are tried. */
export async function readOpenCodeKeys(dir, env = process.env) {
  const keys = await readDatabaseKeys(dir);
  try {
    const auth = JSON.parse(await fs.readFile(path.join(dir, 'auth.json'), 'utf8'));
    const go = auth && auth['opencode-go'];
    if (go && go.type === 'api' && typeof go.key === 'string' && go.key.trim()) keys.push(go.key.trim());
  } catch { /* no auth.json */ }
  if (typeof env.OPENCODE_API_KEY === 'string' && env.OPENCODE_API_KEY.trim()) keys.push(env.OPENCODE_API_KEY.trim());
  return [...new Set(keys)];
}

const win = (key, label, w, lengthMs) => {
  if (!w || typeof w.percent !== 'number' || !Number.isFinite(w.percent)) return null;
  const at = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN;
  return { key, label, used: Math.max(0, Math.min(100, Math.round(w.percent * 10) / 10)), resetsAt: Number.isFinite(at) ? new Date(at).toISOString() : null, ...(lengthMs ? { lengthMs } : {}) };
};

/** Usage response to dashboard windows; the keys line up with the other providers so rings and pace work unchanged. */
export function parseOpenCodeUsage(data) {
  const u = data && typeof data === 'object' ? data.usage : null;
  return { windows: [win('five_hour', 'Go · Session', u?.rolling), win('seven_day', 'Go · Weekly', u?.weekly), win('monthly', 'Go · Monthly', u?.monthly)].filter(Boolean) };
}

/**
 * Status object for one OpenCode account, in the same shape as a Claude account's.
 * @param {{ id: string, name: string, configDir: string }} acc configDir (OpenCode's data folder) already expanded
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeout?: number, env?: NodeJS.ProcessEnv, onRateLimit?: (waitMs: number) => void }} [opts]
 */
export async function fetchOpenCodeStatus(acc, { fetchImpl = fetch, now = Date.now, timeout = OPENCODE_TIMEOUT_MS, env = process.env, onRateLimit } = {}) {
  const base = { id: acc.id, name: acc.name, configDir: acc.configDir, provider: 'opencode', fetchedAt: now() };
  const keys = await readOpenCodeKeys(acc.configDir, env);
  if (!keys.length) {
    return { ...base, status: 'no_login', message: 'No OpenCode key found in this folder. Run "opencode auth login" once, or set OPENCODE_API_KEY for the dashboard server.' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    let res;
    for (const key of keys) {
      res = await fetchImpl(OPENCODE_USAGE_URL, { headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'claude-usage-dashboard/1.0' }, signal: ctl.signal, redirect: 'error' });
      if (res.status !== 401 && res.status !== 403) break; // try the next stored key
    }
    if (res.status === 401) return { ...base, status: 'expired', message: 'OpenCode refused the key. Run "opencode auth login" again.' };
    if (res.status === 403) return { ...base, status: 'error', message: 'This OpenCode key has no Go subscription, so there are no limits to show.' };
    if (res.status === 429) {
      const wait = 5 * 60 * 1000;
      if (onRateLimit) onRateLimit(wait);
      return { ...base, status: 'error', retryAt: now() + wait, message: 'OpenCode is rate limiting usage. Next try in 5 min.' };
    }
    if (!res.ok) return { ...base, status: 'error', message: 'OpenCode usage endpoint answered HTTP ' + res.status + '.' };
    const { windows } = parseOpenCodeUsage(await res.json());
    if (!windows.length) return { ...base, status: 'error', message: 'Unexpected response format (OpenCode may have changed the endpoint).' };
    return { ...base, plan: 'OpenCode Go', status: 'ok', windows };
  } catch (e) {
    const msg = ctl.signal.aborted ? 'request timed out after ' + timeout / 1000 + ' s' : (e && e.message ? e.message : String(e));
    return { ...base, status: 'error', message: 'Could not reach OpenCode: ' + msg };
  } finally { clearTimeout(timer); }
}

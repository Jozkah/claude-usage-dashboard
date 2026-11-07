/* Pure helpers for accounts, history and credentials; imported by server/index.js. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';

export function expandHome(p, home = os.homedir()) {
  if (!p) return p;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

/** Keep only well-formed entries, drop duplicate ids. `dropped` lists what was removed. */
export function normalizeAccounts(list) {
  const accounts = [];
  const dropped = [];
  const seen = new Set();
  for (const a of Array.isArray(list) ? list : []) {
    const ok = a && typeof a === 'object'
      && ['id', 'name', 'configDir'].every((k) => typeof a[k] === 'string' && a[k].trim());
    if (!ok || seen.has(a.id)) { dropped.push(a); continue; }
    seen.add(a.id);
    accounts.push({ id: a.id, name: a.name, configDir: a.configDir, ...(a.provider === 'codex' ? { provider: 'codex' } : {}),
      ...(['standard', 'premium'].includes(a.seatTier) && a.provider !== 'codex' ? { seatTier: a.seatTier } : {}) });
  }
  return { accounts, dropped };
}

/** Give every entry a unique id (suffixing -2, -3 ...). */
export function uniqueIds(entries) {
  const used = new Set();
  return entries.map((e) => {
    let id = e.id;
    for (let n = 2; used.has(id); n++) id = e.id + '-' + n;
    used.add(id);
    return { ...e, id };
  });
}

/** Resolve and verify a config folder. Throws Error with a user-facing message. */
export function validateConfigDir(input, existingDirs = [], home = os.homedir()) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Name and config folder are required.');
  const resolved = path.resolve(expandHome(raw, home));
  let st;
  try { st = fs.statSync(resolved); } catch { throw new Error('Config folder does not exist.'); }
  if (!st.isDirectory()) throw new Error('Config folder must be a directory.');
  const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  if (existingDirs.some((d) => key(path.resolve(expandHome(d, home))) === key(resolved))) {
    throw new Error('That config folder is already added.');
  }
  return resolved;
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Sanitize loaded history into null-prototype maps of arrays of [ms, used]. */
export function sanitizeHistory(raw) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, keys] of Object.entries(raw)) {
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) continue;
    const acc = Object.create(null);
    for (const [key, arr] of Object.entries(keys)) {
      if (Array.isArray(arr)) acc[key] = arr.filter(isPoint);
    }
    out[id] = acc;
  }
  return out;
}

export function historyPoints(history, id, key) {
  if (!Object.hasOwn(history, id)) return [];
  const acc = history[id];
  return Object.hasOwn(acc, key) && Array.isArray(acc[key]) ? acc[key] : [];
}

/** Dead when the pid is not a positive integer or the file has not been touched for `maxAgeMs`. */
export function sessionFileFresh(pid, mtimeMs, now, maxAgeMs = 12 * 3600e3) {
  return Number.isInteger(pid) && pid > 0 && now - mtimeMs < maxAgeMs;
}

/** True when stored expiresAt (ms epoch) is in the past. Unknown or missing => false. */
export function credentialsExpired(creds, now) {
  const at = Number(creds && creds.expiresAt);
  return Number.isFinite(at) && at > 0 && at < now;
}

/**
 * Which Claude Desktop profile belongs to an account's config folder.
 * `~/.claude` is the normal (Personal) app; `~/.claude-<name>` maps to the separate profile `<Name>`
 * (launch-profile.ps1). Anything else has no Desktop profile.
 * @returns {{ kind: 'personal' } | { kind: 'profile', name: string } | null}
 */
export function desktopProfileFor(configDir, home) {
  const resolved = path.resolve(configDir);
  if (resolved === path.join(home, '.claude')) return { kind: 'personal' };
  if (path.dirname(resolved) !== path.resolve(home)) return null;
  const match = /^\.claude-([a-z][a-z0-9]{0,30})$/i.exec(path.basename(resolved));
  if (!match) return null;
  const word = match[1];
  return { kind: 'profile', name: word[0].toUpperCase() + word.slice(1).toLowerCase() };
}

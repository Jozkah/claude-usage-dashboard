import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { writeFileAtomic } from './sync-support.js';

export const KEYCHAIN_TIMEOUT_MS = 3000;

function execFileAsync(cmd, args, options) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
}

/** Reads the Claude Code login for a config folder. File first; on macOS then the keychain (async, 3 s cap). */
export async function readCredentials(configDir, { platform = process.platform, exec = execFileAsync,
  home = os.homedir(), timeout = KEYCHAIN_TIMEOUT_MS } = {}) {
  try {
    const j = JSON.parse(await fs.readFile(path.join(configDir, '.credentials.json'), 'utf8'));
    if (j && j.claudeAiOauth) return j.claudeAiOauth;
  } catch { /* try the keychain next */ }

  if (platform === 'darwin') {
    const isDefault = path.resolve(configDir) === path.join(home, '.claude');
    const service = isDefault
      ? 'Claude Code-credentials'
      // Best effort: Claude Code suffixes the keychain item for custom config folders.
      : 'Claude Code-credentials-' + crypto.createHash('sha256').update(configDir).digest('hex').slice(0, 8);
    try {
      const out = await exec('security', ['find-generic-password', '-s', service, '-w'],
        { encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
      const j = JSON.parse(out.trim());
      if (j && j.claudeAiOauth) return j.claudeAiOauth;
    } catch { /* not found, denied or timed out */ }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Access-token renewal                                                */
/* ------------------------------------------------------------------ */
// Claude Code only renews its short-lived access token when it runs with that config folder, so an account
// used elsewhere (Desktop, another PC, a quiet profile) goes stale here. Same OAuth refresh call Claude Code makes.
export const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
export const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const REFRESH_TIMEOUT_MS = 15_000;
export const REFRESH_RETRY_MS = 10 * 60 * 1000; // after a failed renewal, do not ask again for this long
const MARGIN_MS = 60_000;

const refreshing = new Map(); // configDir -> in-flight promise (single flight per folder)
const failedAt = new Map();   // configDir -> time of last failed renewal

const usable = (c, now) => Boolean(c && c.accessToken && !(Number(c.expiresAt) > 0 && Number(c.expiresAt) < now + MARGIN_MS));

async function readFileCreds(file) {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    return raw && raw.claudeAiOauth ? { raw, oauth: raw.claudeAiOauth } : null;
  } catch { return null; }
}

/**
 * Renews an expired login from its refresh token and writes it back to the config folder's .credentials.json
 * (atomic rename, every other field kept). Returns the fresh oauth object, or null when it cannot be renewed
 * (no refresh token, macOS keychain login, Anthropic refused, offline, or a recent failure). Never throws.
 * If Claude Code renewed the file meanwhile, that newer login is returned and nothing is overwritten.
 */
export function refreshCredentials(configDir, stale, opts = {}) {
  const key = path.resolve(configDir);
  const now = (opts.now || Date.now)();
  if (refreshing.has(key)) return refreshing.get(key);
  if (now - (failedAt.get(key) || 0) < (opts.retryMs ?? REFRESH_RETRY_MS)) return Promise.resolve(null);
  const job = doRefresh(key, stale, opts).catch(() => null).finally(() => refreshing.delete(key));
  refreshing.set(key, job);
  return job;
}

async function doRefresh(configDir, stale, { fetchImpl = fetch, now = Date.now, timeout = REFRESH_TIMEOUT_MS,
  writeFile = writeFileAtomic } = {}) {
  const file = path.join(configDir, '.credentials.json');
  const fail = () => { failedAt.set(configDir, now()); return null; };
  const before = await readFileCreds(file);
  if (!before) return null; // keychain or unreadable: leave it to Claude Code
  if (usable(before.oauth, now()) && before.oauth.accessToken !== (stale && stale.accessToken)) return before.oauth;
  const refreshToken = before.oauth.refreshToken;
  if (!refreshToken) return fail();

  const body = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: OAUTH_CLIENT_ID };
  if (Array.isArray(before.oauth.scopes) && before.oauth.scopes.length) body.scope = before.oauth.scopes.join(' ');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let data;
  try {
    const res = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch {
    // Another process may have renewed (and rotated the refresh token) while we were asking.
    const after = await readFileCreds(file);
    return after && usable(after.oauth, now()) && after.oauth.accessToken !== (stale && stale.accessToken) ? after.oauth : fail();
  } finally { clearTimeout(timer); }
  if (!data || typeof data.access_token !== 'string' || !data.access_token) return fail();

  // Re-read right before writing: if the file moved on, Claude Code won the race, so keep its login.
  const current = await readFileCreds(file);
  if (!current || current.oauth.refreshToken !== refreshToken) {
    return current && usable(current.oauth, now()) ? current.oauth : fail();
  }
  const expiresIn = Number(data.expires_in);
  const oauth = {
    ...current.oauth,
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : refreshToken,
    expiresAt: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
  // Anthropic has already rotated the refresh token, so storing the new one matters: retry briefly (Windows can
  // hold the file open). If it still fails, use the token for this poll and say so.
  const text = JSON.stringify({ ...current.raw, claudeAiOauth: oauth });
  let stored = false;
  for (let attempt = 0; attempt < 4 && !stored; attempt++) {
    try { writeFile(file, text); stored = true; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  if (!stored) console.warn(`Could not save the renewed login to ${file}; sign in again if this account shows as expired.`);
  failedAt.delete(configDir);
  return oauth;
}

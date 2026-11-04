import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './sync-support.js';

// Codex (ChatGPT sign-in) usage. The CLI keeps its login in <CODEX_HOME>/auth.json; the ChatGPT backend reports the
// same two windows `/status` shows (5-hour and weekly). The endpoint is undocumented, so every failure degrades to a
// readable status instead of an exception. An expired access token is renewed the way the Codex CLI does it (see
// refreshCodexAuth); DASHBOARD_NO_REFRESH=1 keeps the login strictly read-only.
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const CODEX_TIMEOUT_MS = 20_000;
export const CODEX_EXPIRED_MESSAGE = 'Codex login expired. Open Codex once with this account and it will refresh itself.';

/** Reads the ChatGPT login Codex stores. Returns null when missing or not a ChatGPT login (e.g. API-key mode). */
export async function readCodexAuth(codexHome) {
  let raw;
  try { raw = JSON.parse(await fs.readFile(path.join(codexHome, 'auth.json'), 'utf8')); } catch { return null; }
  const tokens = raw && raw.tokens;
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token) return null;
  return {
    accessToken: tokens.access_token,
    accountId: typeof tokens.account_id === 'string' ? tokens.account_id : '',
    expiresAt: jwtExpiry(tokens.access_token),
    refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '',
    raw,
  };
}

export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'; // the public Codex CLI app registration
export const CODEX_REFRESH_TIMEOUT_MS = 30_000;
export const CODEX_REFRESH_RETRY_MS = 10 * 60 * 1000;
const refreshing = new Map(); // codexHome -> in-flight promise (single flight per folder)
const failedAt = new Map(); // codexHome -> time of the last failed renewal

function claim(token, name) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))[name]; } catch { return undefined; }
}

/**
 * Renews the access token from the stored refresh token, as the Codex CLI does (POST auth.openai.com/oauth/token,
 * JSON body). Refresh tokens rotate and are single use, so the new login is written back (atomic, other fields kept)
 * and, if Codex renewed the file meanwhile, that newer login is kept instead. Never throws; null when it cannot renew.
 */
export function refreshCodexAuth(codexHome, stale, opts = {}) {
  const key = path.resolve(codexHome);
  const now = (opts.now || Date.now)();
  if (refreshing.has(key)) return refreshing.get(key);
  if (now - (failedAt.get(key) || 0) < (opts.retryMs ?? CODEX_REFRESH_RETRY_MS)) return Promise.resolve(null);
  const job = doRefresh(key, stale, opts).catch(() => null).finally(() => refreshing.delete(key));
  refreshing.set(key, job);
  return job;
}

async function doRefresh(codexHome, stale, { fetchImpl = fetch, now = Date.now, timeout = CODEX_REFRESH_TIMEOUT_MS, writeFile = writeFileAtomic } = {}) {
  const fail = () => { failedAt.set(codexHome, now()); return null; };
  const usable = (a) => a && a.accessToken && !(a.expiresAt && a.expiresAt < now() + 60_000);
  const before = await readCodexAuth(codexHome);
  if (!before) return null;
  if (usable(before) && before.accessToken !== (stale && stale.accessToken)) return before; // Codex already renewed it
  if (!before.refreshToken) return fail();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let data;
  try {
    const res = await fetchImpl(CODEX_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ client_id: claim(before.accessToken, 'client_id') || CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: before.refreshToken }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch {
    const after = await readCodexAuth(codexHome); // the CLI may have renewed while we asked
    return usable(after) && after.accessToken !== (stale && stale.accessToken) ? after : fail();
  } finally { clearTimeout(timer); }
  if (!data || typeof data.access_token !== 'string' || !data.access_token) return fail();

  const current = await readCodexAuth(codexHome);
  if (!current || current.refreshToken !== before.refreshToken) return usable(current) ? current : fail();
  const tokens = { ...current.raw.tokens, access_token: data.access_token };
  if (typeof data.refresh_token === 'string' && data.refresh_token) tokens.refresh_token = data.refresh_token;
  if (typeof data.id_token === 'string' && data.id_token) tokens.id_token = data.id_token;
  const text = JSON.stringify({ ...current.raw, tokens, last_refresh: new Date(now()).toISOString() }, null, 2);
  const file = path.join(codexHome, 'auth.json');
  let stored = false;
  for (let attempt = 0; attempt < 4 && !stored; attempt++) {
    try { writeFile(file, text); stored = true; } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  if (!stored) console.warn(`Could not save the renewed Codex login to ${file}; run "codex login" if this account shows as expired.`);
  failedAt.delete(codexHome);
  return readCodexAuth(codexHome).then((a) => a || { accessToken: data.access_token, accountId: current.accountId, expiresAt: jwtExpiry(data.access_token) });
}

/** Expiry (ms epoch) from a JWT payload; null when it cannot be read. The signature is not checked, it is only a hint. */
export function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch { return null; }
}

const isoFromEpochSeconds = (s) => (Number.isFinite(s) && s > 0 ? new Date(s * 1000).toISOString() : null);

/** Maps the wham usage response to the dashboard's windows ({ key, label, used, resetsAt }). */
export function parseCodexUsage(data) {
  const limit = data && typeof data === 'object' ? data.rate_limit : null;
  const windows = [];
  for (const [slot, fallback] of [['primary_window', 'five_hour'], ['secondary_window', 'seven_day']]) {
    const w = limit && limit[slot];
    if (!w || typeof w.used_percent !== 'number') continue;
    const seconds = Number(w.limit_window_seconds);
    // Keys line up with Claude's so rings, pace and "tightest limit" work unchanged.
    const key = seconds >= 6 * 86400 ? 'seven_day' : seconds > 0 && seconds <= 12 * 3600 ? 'five_hour' : fallback;
    const resetsAt = isoFromEpochSeconds(w.reset_at)
      ?? (Number.isFinite(w.reset_after_seconds) ? new Date(Date.now() + w.reset_after_seconds * 1000).toISOString() : null);
    windows.push({
      key,
      label: key === 'five_hour' ? '5-hour session' : 'Weekly · all models',
      used: Math.max(0, Math.min(100, Math.round(w.used_percent * 10) / 10)),
      resetsAt,
    });
  }
  windows.sort((a, b) => (a.key === 'five_hour' ? 0 : 1) - (b.key === 'five_hour' ? 0 : 1));
  const plan = typeof data?.plan_type === 'string' && data.plan_type ? `Codex ${data.plan_type[0].toUpperCase()}${data.plan_type.slice(1)}` : 'Codex';
  return { plan, windows };
}

/**
 * Status object for one Codex account, in the same shape as a Claude account's.
 * @param {{ id: string, name: string, configDir: string }} acc configDir already expanded
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeout?: number, onRateLimit?: (waitMs: number) => void, refresh?: ((dir: string, stale: any, opts?: any) => Promise<any>) | null }} [opts]
 */
export async function fetchCodexStatus(acc, { fetchImpl = fetch, now = Date.now, timeout = CODEX_TIMEOUT_MS, onRateLimit, refresh = refreshCodexAuth } = {}) {
  const base = { id: acc.id, name: acc.name, configDir: acc.configDir, provider: 'codex', fetchedAt: now() };
  let auth = await readCodexAuth(acc.configDir);
  if (!auth) {
    return { ...base, status: 'no_login', message: 'No Codex ChatGPT login found in this folder. Run "codex login" once with this account.' };
  }
  if (auth.expiresAt && auth.expiresAt < now()) {
    const fresh = refresh ? await refresh(acc.configDir, auth, { fetchImpl, now }) : null;
    if (fresh) auth = fresh; else return { ...base, status: 'expired', message: CODEX_EXPIRED_MESSAGE };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const call = (a) => {
      const headers = { Authorization: 'Bearer ' + a.accessToken, 'User-Agent': 'claude-usage-dashboard/1.0' };
      if (a.accountId) headers['ChatGPT-Account-Id'] = a.accountId;
      return fetchImpl(CODEX_USAGE_URL, { headers, signal: ctl.signal });
    };
    let res = await call(auth);
    if (res.status === 401 && refresh) { // rejected token: one renewal attempt, then retry once
      const fresh = await refresh(acc.configDir, auth, { fetchImpl, now });
      if (fresh && fresh.accessToken !== auth.accessToken) res = await call(fresh);
    }
    if (res.status === 401) return { ...base, status: 'expired', message: CODEX_EXPIRED_MESSAGE };
    if (res.status === 403) {
      return { ...base, status: 'error', message: 'ChatGPT refused the usage request (HTTP 403). This account may not expose Codex usage.' };
    }
    if (res.status === 429) {
      const wait = 5 * 60 * 1000;
      if (onRateLimit) onRateLimit(wait);
      return { ...base, status: 'error', retryAt: now() + wait, message: 'ChatGPT is rate limiting usage. Next try in 5 min.' };
    }
    if (!res.ok) return { ...base, status: 'error', message: 'ChatGPT usage endpoint answered HTTP ' + res.status + '.' };
    const { plan, windows } = parseCodexUsage(await res.json());
    if (!windows.length) {
      return { ...base, plan, status: 'error', message: 'Unexpected response format (OpenAI may have changed the endpoint).' };
    }
    return { ...base, plan, status: 'ok', windows };
  } catch (e) {
    const msg = ctl.signal.aborted ? 'request timed out after ' + timeout / 1000 + ' s' : (e && e.message ? e.message : String(e));
    return { ...base, status: 'error', message: 'Could not reach ChatGPT: ' + msg };
  } finally { clearTimeout(timer); }
}

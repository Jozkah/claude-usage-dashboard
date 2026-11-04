import fs from 'node:fs/promises';
import path from 'node:path';

// Codex (ChatGPT sign-in) usage. The CLI keeps its login in <CODEX_HOME>/auth.json; the ChatGPT backend reports the
// same two windows `/status` shows (5-hour and weekly). The endpoint is undocumented, so every failure degrades to a
// readable status instead of an exception. The login is read-only here: Codex renews it when it runs.
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
  };
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
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeout?: number, onRateLimit?: (waitMs: number) => void }} [opts]
 */
export async function fetchCodexStatus(acc, { fetchImpl = fetch, now = Date.now, timeout = CODEX_TIMEOUT_MS, onRateLimit } = {}) {
  const base = { id: acc.id, name: acc.name, configDir: acc.configDir, provider: 'codex', fetchedAt: now() };
  const auth = await readCodexAuth(acc.configDir);
  if (!auth) {
    return { ...base, status: 'no_login', message: 'No Codex ChatGPT login found in this folder. Run "codex login" once with this account.' };
  }
  if (auth.expiresAt && auth.expiresAt < now()) return { ...base, status: 'expired', message: CODEX_EXPIRED_MESSAGE };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = { Authorization: 'Bearer ' + auth.accessToken, 'User-Agent': 'claude-usage-dashboard/1.0' };
    if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
    const res = await fetchImpl(CODEX_USAGE_URL, { headers, signal: ctl.signal });
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

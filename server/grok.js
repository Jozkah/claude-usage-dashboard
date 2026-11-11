import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Grok Build (xAI) subscription usage. Same approach as the Grok CLI itself: the login the CLI stores
 * (GROK_HOME/auth.json) is sent to the billing endpoint the CLI uses. The shape of the endpoint and of the
 * login file follows what t3code (github.com/pingdotgg/t3code) documents for the same CLI.
 * The endpoint is undocumented and may change without notice.
 */
export const GROK_USAGE_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
export const GROK_TIMEOUT_MS = 20_000;
const SCOPES = ['https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828', 'https://accounts.x.ai/sign-in'];

/** Reads the subscription login the CLI keeps. Null when missing, in API-key mode, or without a token. */
export async function readGrokAuth(home) {
  let raw;
  try { raw = JSON.parse(await fs.readFile(path.join(home, 'auth.json'), 'utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  // Never pick an arbitrary account from other deployments stored in the same file.
  const entry = SCOPES.map((k) => raw[k]).find((v) => v && typeof v === 'object');
  if (!entry || entry.auth_mode === 'api_key') return null;
  const token = typeof entry.key === 'string' ? entry.key.trim() : '';
  if (!token) return null;
  return { token, email: typeof entry.email === 'string' ? entry.email.trim() : '' };
}

const ms = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v.trim())) return NaN;
  return Date.parse(v);
};

/** Billing response to dashboard windows. A weekly period maps onto the weekly key; a monthly one onto "monthly". */
export function parseGrokUsage(data) {
  const cfg = data && typeof data === 'object' ? data.config : null;
  const period = cfg && cfg.currentPeriod;
  const type = typeof period?.type === 'string' ? period.type.replace(/^USAGE_PERIOD_TYPE_/, '') : '';
  const kind = type === 'WEEKLY' ? 'weekly' : type === 'MONTHLY' ? 'monthly' : 'other';
  const start = ms(period?.start);
  const end = ms(period?.end);
  let used = cfg?.creditUsagePercent;
  // Grok omits a zero percentage while still reporting the whole period.
  if (used === undefined && (kind === 'weekly' || kind === 'monthly') && start < end) used = 0;
  if (typeof used !== 'number' || !Number.isFinite(used)) return { windows: [] };
  const key = kind === 'weekly' ? 'seven_day' : kind === 'monthly' ? 'monthly' : 'subscription';
  const label = kind === 'weekly' ? 'Weekly' : kind === 'monthly' ? 'Monthly' : 'Subscription';
  return {
    windows: [{
      key, label,
      used: Math.max(0, Math.min(100, Math.round(used * 10) / 10)),
      resetsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
      ...(Number.isFinite(start) && Number.isFinite(end) && end > start ? { lengthMs: end - start } : {}),
    }],
  };
}

/**
 * Status object for one Grok Build account, in the same shape as a Claude account's.
 * @param {{ id: string, name: string, configDir: string }} acc configDir already expanded
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeout?: number, onRateLimit?: (waitMs: number) => void }} [opts]
 */
export async function fetchGrokStatus(acc, { fetchImpl = fetch, now = Date.now, timeout = GROK_TIMEOUT_MS, onRateLimit } = {}) {
  const base = { id: acc.id, name: acc.name, configDir: acc.configDir, provider: 'grok', fetchedAt: now() };
  const auth = await readGrokAuth(acc.configDir);
  if (!auth) {
    return { ...base, status: 'no_login', message: 'No Grok Build subscription login found in this folder. Run "grok login" once with this account.' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetchImpl(GROK_USAGE_URL, { headers: { Authorization: 'Bearer ' + auth.token, 'User-Agent': 'claude-usage-dashboard/1.0' }, signal: ctl.signal, redirect: 'error' });
    if (res.status === 401) return { ...base, status: 'expired', message: 'Grok login expired. Open Grok once with this account and it will refresh itself.' };
    if (res.status === 403) {
      let detail = '';
      try { detail = String((await res.json())?.error || ''); } catch { /* not JSON */ }
      return { ...base, status: 'error', message: detail.includes('privacy-mode') ? 'Switch your xAI account to Privacy Mode to show Grok usage limits.' : 'xAI refused the usage request (HTTP 403).' };
    }
    if (res.status === 429) {
      const wait = 5 * 60 * 1000;
      if (onRateLimit) onRateLimit(wait);
      return { ...base, status: 'error', retryAt: now() + wait, message: 'xAI is rate limiting usage. Next try in 5 min.' };
    }
    if (!res.ok) return { ...base, status: 'error', message: 'xAI usage endpoint answered HTTP ' + res.status + '.' };
    const { windows } = parseGrokUsage(await res.json());
    if (!windows.length) return { ...base, status: 'error', message: 'Unexpected response format (xAI may have changed the endpoint).' };
    return { ...base, plan: 'Grok Build', status: 'ok', windows };
  } catch (e) {
    const msg = ctl.signal.aborted ? 'request timed out after ' + timeout / 1000 + ' s' : (e && e.message ? e.message : String(e));
    return { ...base, status: 'error', message: 'Could not reach xAI: ' + msg };
  } finally { clearTimeout(timer); }
}

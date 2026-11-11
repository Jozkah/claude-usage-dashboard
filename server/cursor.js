/**
 * Cursor plan usage. Cursor keeps no readable login file, so the account is read with a Cursor API key from the
 * server's environment: CURSOR_API_KEY_<ACCOUNT_ID> for that account, else CURSOR_API_KEY. The key is traded for
 * the short-lived access token Cursor's RPCs accept (the same exchange @cursor/sdk does), then the current billing
 * period's percentages are read. Endpoints and shapes follow what t3code (github.com/pingdotgg/t3code) documents;
 * they are undocumented and can change without notice.
 */
export const CURSOR_API = 'https://api2.cursor.sh';
export const CURSOR_TIMEOUT_MS = 20_000;

/** Environment variable names that may hold this account's API key, most specific first. */
export function cursorKeyNames(id) {
  return [`CURSOR_API_KEY_${String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`, 'CURSOR_API_KEY'];
}

export function cursorApiKey(id, env = process.env) {
  for (const name of cursorKeyNames(id)) { const v = typeof env[name] === 'string' ? env[name].trim() : ''; if (v) return v; }
  return '';
}

const epoch = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : NaN; };

/** Billing-period response to dashboard windows (one per percentage Cursor reports). */
export function parseCursorUsage(data) {
  const plan = data && typeof data === 'object' ? data.planUsage : null;
  const start = epoch(data?.billingCycleStart);
  const end = epoch(data?.billingCycleEnd);
  const windows = [];
  for (const [field, key, label] of [['totalPercentUsed', 'monthly', 'Monthly · total'], ['autoPercentUsed', 'monthly_auto', 'Monthly · auto'], ['apiPercentUsed', 'monthly_api', 'Monthly · API']]) {
    const v = plan && plan[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    windows.push({
      key, label,
      used: Math.max(0, Math.min(100, Math.round(v * 10) / 10)),
      resetsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
      ...(Number.isFinite(start) && Number.isFinite(end) && end > start ? { lengthMs: end - start } : {}),
    });
  }
  return { windows };
}

/**
 * Status object for one Cursor account, in the same shape as a Claude account's.
 * @param {{ id: string, name: string, configDir: string }} acc
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeout?: number, env?: NodeJS.ProcessEnv, onRateLimit?: (waitMs: number) => void }} [opts]
 */
export async function fetchCursorStatus(acc, { fetchImpl = fetch, now = Date.now, timeout = CURSOR_TIMEOUT_MS, env = process.env, onRateLimit } = {}) {
  const base = { id: acc.id, name: acc.name, configDir: acc.configDir, provider: 'cursor', fetchedAt: now() };
  const apiKey = cursorApiKey(acc.id, env);
  if (!apiKey) {
    return { ...base, status: 'no_login', message: `Set ${cursorKeyNames(acc.id)[0]} (or CURSOR_API_KEY) for the dashboard server to read this Cursor plan, then restart it.` };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const json = (url, token, body) => fetchImpl(url, {
    method: 'POST', signal: ctl.signal, redirect: 'error', body: JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'connect-protocol-version': '1', 'x-cursor-client-type': 'cli', 'User-Agent': 'claude-usage-dashboard/1.0' },
  });
  try {
    const ex = await json(`${CURSOR_API}/auth/exchange_user_api_key`, apiKey, {});
    if (ex.status === 401 || ex.status === 403) return { ...base, status: 'expired', message: 'Cursor refused this API key. Create a new one in Cursor and update the environment variable.' };
    if (ex.status === 429) {
      const wait = 5 * 60 * 1000;
      if (onRateLimit) onRateLimit(wait);
      return { ...base, status: 'error', retryAt: now() + wait, message: 'Cursor is rate limiting usage. Next try in 5 min.' };
    }
    if (!ex.ok) return { ...base, status: 'error', message: 'Cursor key exchange answered HTTP ' + ex.status + '.' };
    const token = (await ex.json())?.accessToken;
    if (typeof token !== 'string' || !token) return { ...base, status: 'error', message: 'Unexpected response format (Cursor may have changed the endpoint).' };
    const res = await json(`${CURSOR_API}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`, token, {});
    if (res.status === 401 || res.status === 403) return { ...base, status: 'expired', message: 'Cursor refused the usage request. Check that the API key belongs to a paid plan.' };
    if (!res.ok) return { ...base, status: 'error', message: 'Cursor usage endpoint answered HTTP ' + res.status + '.' };
    const { windows } = parseCursorUsage(await res.json());
    if (!windows.length) return { ...base, status: 'error', message: 'Cursor reported no plan usage for this account.' };
    return { ...base, plan: 'Cursor', status: 'ok', windows };
  } catch (e) {
    const msg = ctl.signal.aborted ? 'request timed out after ' + timeout / 1000 + ' s' : (e && e.message ? e.message : String(e));
    return { ...base, status: 'error', message: 'Could not reach Cursor: ' + msg };
  } finally { clearTimeout(timer); }
}

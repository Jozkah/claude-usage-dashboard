import test from 'node:test';
import assert from 'node:assert/strict';
import { cursorApiKey, cursorKeyNames, fetchCursorStatus, parseCursorUsage, CURSOR_API } from './cursor.js';

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const acc = { id: 'cursor-work', name: 'Cursor Work', configDir: '~/.cursor-work' };

test('API key comes from the account-specific variable first, then the shared one', () => {
  assert.deepEqual(cursorKeyNames('cursor-work'), ['CURSOR_API_KEY_CURSOR_WORK', 'CURSOR_API_KEY']);
  assert.equal(cursorApiKey('cursor-work', { CURSOR_API_KEY: ' shared ', CURSOR_API_KEY_CURSOR_WORK: 'own' }), 'own');
  assert.equal(cursorApiKey('cursor-work', { CURSOR_API_KEY: ' shared ' }), 'shared');
  assert.equal(cursorApiKey('cursor-work', {}), '');
});

test('parseCursorUsage keeps each percentage as a window with the billing period length', () => {
  const { windows } = parseCursorUsage({
    billingCycleStart: '1762000000000', billingCycleEnd: String(1762000000000 + 30 * 864e5),
    planUsage: { totalPercentUsed: 42.04, autoPercentUsed: 10, apiPercentUsed: 'x' },
  });
  assert.deepEqual(windows.map((w) => [w.key, w.used]), [['monthly', 42], ['monthly_auto', 10]]);
  assert.equal(windows[0].lengthMs, 30 * 864e5);
  assert.ok(windows[0].resetsAt.startsWith('2025-12'));
  assert.deepEqual(parseCursorUsage({}).windows, []);
});

test('fetchCursorStatus: exchanges the key then reads usage; reports a missing key, bad key, limits and failures', async () => {
  assert.equal((await fetchCursorStatus(acc, { env: {} })).status, 'no_login');
  const calls = [];
  const ok = await fetchCursorStatus(acc, {
    env: { CURSOR_API_KEY: 'key' },
    fetchImpl: async (url, init) => {
      calls.push([url, init.headers.Authorization]);
      return url.endsWith('/auth/exchange_user_api_key') ? json(200, { accessToken: 'access' })
        : json(200, { billingCycleStart: '1762000000000', billingCycleEnd: '1764592000000', planUsage: { totalPercentUsed: 12 } });
    },
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.provider, 'cursor');
  assert.deepEqual(calls, [[`${CURSOR_API}/auth/exchange_user_api_key`, 'Bearer key'], [`${CURSOR_API}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`, 'Bearer access']]);

  const env = { CURSOR_API_KEY: 'key' };
  assert.equal((await fetchCursorStatus(acc, { env, fetchImpl: async () => json(401, {}) })).status, 'expired');
  let waited = 0;
  const limited = await fetchCursorStatus(acc, { env, now: () => 5, onRateLimit: (w) => { waited = w; }, fetchImpl: async () => json(429, {}) });
  assert.equal(limited.retryAt, 5 + waited);
  assert.equal((await fetchCursorStatus(acc, { env, fetchImpl: async (u) => (u.includes('exchange') ? json(200, {}) : json(200, {})) })).status, 'error');
  assert.match((await fetchCursorStatus(acc, { env, fetchImpl: async () => { throw new Error('offline'); } })).message, /offline/);
});

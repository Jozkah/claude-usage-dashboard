import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexAuth, jwtExpiry, parseCodexUsage, fetchCodexStatus, CODEX_USAGE_URL, CODEX_EXPIRED_MESSAGE } from './codex.js';

const NOW = 1_800_000_000_000;
const jwt = (exp) => 'h.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.s';
function home(auth) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
  if (auth) fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(auth));
  return dir;
}
const good = (exp = NOW / 1000 + 3600) => ({ auth_mode: 'chatgpt', tokens: { access_token: jwt(exp), refresh_token: 'r', account_id: 'acct-1' } });
const usage = {
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 26, limit_window_seconds: 18000, reset_at: 1_800_003_600 },
    secondary_window: { used_percent: 83.04, limit_window_seconds: 604800, reset_at: 1_800_200_000 },
  },
};
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const acc = (dir) => ({ id: 'codex', name: 'Codex', configDir: dir });

test('reads the ChatGPT login and its expiry; ignores API-key mode and missing files', async () => {
  const dir = home(good(1_900_000_000));
  assert.deepEqual(await readCodexAuth(dir), { accessToken: jwt(1_900_000_000), accountId: 'acct-1', expiresAt: 1_900_000_000_000 });
  assert.equal(await readCodexAuth(home({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-x', tokens: null })), null);
  assert.equal(await readCodexAuth(home(null)), null);
  assert.equal(jwtExpiry('garbage'), null);
});

test('maps the two windows to the dashboard keys and labels the plan', () => {
  const { plan, windows } = parseCodexUsage(usage);
  assert.equal(plan, 'Codex Plus');
  assert.deepEqual(windows.map((w) => [w.key, w.used]), [['five_hour', 26], ['seven_day', 83]]);
  assert.equal(windows[0].resetsAt, new Date(1_800_003_600 * 1000).toISOString());
  assert.deepEqual(parseCodexUsage({}).windows, []);
  // window length decides the key even when the slots swap
  const swapped = parseCodexUsage({ rate_limit: { primary_window: usage.rate_limit.secondary_window, secondary_window: usage.rate_limit.primary_window } });
  assert.deepEqual(swapped.windows.map((w) => w.key), ['five_hour', 'seven_day']);
});

test('fetches usage with the bearer token and account header', async () => {
  let seen;
  const status = await fetchCodexStatus(acc(home(good())), {
    now: () => NOW,
    fetchImpl: async (url, init) => { seen = { url, headers: init.headers }; return reply(200, usage)(); },
  });
  assert.equal(seen.url, CODEX_USAGE_URL);
  assert.equal(seen.headers['ChatGPT-Account-Id'], 'acct-1');
  assert.match(seen.headers.Authorization, /^Bearer h\./);
  assert.equal(status.status, 'ok');
  assert.equal(status.provider, 'codex');
  assert.equal(status.windows.length, 2);
});

test('reports expired, missing, refused, rate-limited and broken responses without throwing', async () => {
  const expired = await fetchCodexStatus(acc(home(good(NOW / 1000 - 10))), { now: () => NOW, fetchImpl: () => { throw new Error('must not call'); } });
  assert.equal(expired.status, 'expired');
  assert.equal(expired.message, CODEX_EXPIRED_MESSAGE);
  assert.equal((await fetchCodexStatus(acc(home(null)), { now: () => NOW })).status, 'no_login');
  const run = (r) => fetchCodexStatus(acc(home(good())), { now: () => NOW, fetchImpl: r });
  assert.equal((await run(reply(401, {}))).status, 'expired');
  assert.match((await run(reply(403, {}))).message, /403/);
  let waited = 0;
  const limited = await fetchCodexStatus(acc(home(good())), { now: () => NOW, fetchImpl: reply(429, {}), onRateLimit: (w) => { waited = w; } });
  assert.equal(limited.status, 'error');
  assert.equal(limited.retryAt, NOW + waited);
  assert.match((await run(reply(200, { rate_limit: {} }))).message, /Unexpected response/);
  assert.match((await run(async () => { throw new Error('offline'); })).message, /offline/);
});

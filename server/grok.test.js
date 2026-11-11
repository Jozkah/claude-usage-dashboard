import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchGrokStatus, parseGrokUsage, readGrokAuth, GROK_USAGE_URL } from './grok.js';

const SCOPE = 'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828';
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grok-'));
const writeAuth = (dir, value) => fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(value));
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('readGrokAuth reads the subscription login and ignores API-key mode and other deployments', async () => {
  const d = home();
  try {
    assert.equal(await readGrokAuth(d), null); // no file
    writeAuth(d, { [SCOPE]: { key: ' tok ', email: 'a@b.c' } });
    assert.deepEqual(await readGrokAuth(d), { token: 'tok', email: 'a@b.c' });
    writeAuth(d, { [SCOPE]: { key: 'tok', auth_mode: 'api_key' } });
    assert.equal(await readGrokAuth(d), null);
    writeAuth(d, { 'https://other.example': { key: 'tok' } });
    assert.equal(await readGrokAuth(d), null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('parseGrokUsage maps weekly and monthly periods and a missing percentage to zero', () => {
  const weekly = parseGrokUsage({ config: { creditUsagePercent: 41.26, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-09T00:00:00Z', end: '2026-11-16T00:00:00Z' } } });
  assert.equal(weekly.windows[0].key, 'seven_day');
  assert.equal(weekly.windows[0].used, 41.3);
  assert.equal(weekly.windows[0].resetsAt, '2026-11-16T00:00:00.000Z');
  const monthly = parseGrokUsage({ config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY', start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' } } });
  assert.equal(monthly.windows[0].key, 'monthly');
  assert.equal(monthly.windows[0].used, 0);
  assert.equal(monthly.windows[0].lengthMs, 30 * 864e5);
  assert.deepEqual(parseGrokUsage({}).windows, []);
  assert.deepEqual(parseGrokUsage({ config: { creditUsagePercent: 'x' } }).windows, []);
});

test('fetchGrokStatus: ok, no login, expired, privacy mode, rate limit, bad shape and network failure', async () => {
  const d = home();
  try {
    const acc = { id: 'g', name: 'Grok', configDir: d };
    assert.equal((await fetchGrokStatus(acc)).status, 'no_login');
    writeAuth(d, { [SCOPE]: { key: 'tok' } });
    let seen;
    const ok = await fetchGrokStatus(acc, { fetchImpl: async (url, init) => { seen = { url, auth: init.headers.Authorization }; return json(200, { config: { creditUsagePercent: 10, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', start: '2026-11-09T00:00:00Z', end: '2026-11-16T00:00:00Z' } } }); } });
    assert.equal(ok.status, 'ok');
    assert.equal(ok.provider, 'grok');
    assert.deepEqual(seen, { url: GROK_USAGE_URL, auth: 'Bearer tok' });
    assert.equal((await fetchGrokStatus(acc, { fetchImpl: async () => json(401, {}) })).status, 'expired');
    const privacy = await fetchGrokStatus(acc, { fetchImpl: async () => json(403, { error: 'WKE=privacy-mode:legacy' }) });
    assert.match(privacy.message, /Privacy Mode/);
    let waited = 0;
    const limited = await fetchGrokStatus(acc, { fetchImpl: async () => json(429, {}), onRateLimit: (w) => { waited = w; }, now: () => 1000 });
    assert.equal(limited.retryAt, 1000 + waited);
    assert.equal((await fetchGrokStatus(acc, { fetchImpl: async () => json(200, { nope: 1 }) })).status, 'error');
    assert.match((await fetchGrokStatus(acc, { fetchImpl: async () => { throw new Error('boom'); } })).message, /boom/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

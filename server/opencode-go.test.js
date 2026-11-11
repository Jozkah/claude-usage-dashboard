import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchOpenCodeStatus, parseOpenCodeUsage, parseStoredKey, readOpenCodeKeys, OPENCODE_USAGE_URL } from './opencode-go.js';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-'));
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const usage = { usage: { rolling: { percent: 12.34, resetsAt: '2026-11-11T18:00:00Z' }, weekly: { percent: 30, resetsAt: '2026-11-16T00:00:00Z' }, monthly: { percent: 8, resetsAt: '2026-12-01T00:00:00Z' } } };

test('parseStoredKey accepts hosted keys only', () => {
  assert.equal(parseStoredKey(JSON.stringify({ type: 'key', key: ' k1 ' })), 'k1');
  assert.equal(parseStoredKey(JSON.stringify({ type: 'key', key: 'k', metadata: { server: 'https://opencode.ai/console/' } })), 'k');
  assert.equal(parseStoredKey(JSON.stringify({ type: 'key', key: 'k', metadata: { server: 'https://self-hosted.example' } })), null);
  assert.equal(parseStoredKey(JSON.stringify({ type: 'oauth', key: 'k' })), null);
  assert.equal(parseStoredKey('not json'), null);
});

test('readOpenCodeKeys: auth.json, then the environment; no duplicates', async () => {
  const d = dir();
  try {
    assert.deepEqual(await readOpenCodeKeys(d, {}), []);
    fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api', key: 'from-file' } }));
    assert.deepEqual(await readOpenCodeKeys(d, { OPENCODE_API_KEY: 'from-env' }), ['from-file', 'from-env']);
    assert.deepEqual(await readOpenCodeKeys(d, { OPENCODE_API_KEY: 'from-file' }), ['from-file']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('parseOpenCodeUsage maps rolling, weekly and monthly onto the shared window keys', () => {
  const { windows } = parseOpenCodeUsage(usage);
  assert.deepEqual(windows.map((w) => [w.key, w.used]), [['five_hour', 12.3], ['seven_day', 30], ['monthly', 8]]);
  assert.equal(windows[0].resetsAt, '2026-11-11T18:00:00.000Z');
  assert.deepEqual(parseOpenCodeUsage({}).windows, []);
});

test('fetchOpenCodeStatus: ok, no key, second key after a 403, no Go plan, expired, rate limit, bad shape, network', async () => {
  const d = dir();
  try {
    const acc = { id: 'oc', name: 'OpenCode', configDir: d };
    assert.equal((await fetchOpenCodeStatus(acc, { env: {} })).status, 'no_login');
    fs.writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api', key: 'a' } }));
    const tried = [];
    const ok = await fetchOpenCodeStatus(acc, {
      env: { OPENCODE_API_KEY: 'b' },
      fetchImpl: async (url, init) => { tried.push([url, init.headers.Authorization]); return init.headers.Authorization === 'Bearer b' ? json(200, usage) : json(403, {}); },
    });
    assert.equal(ok.status, 'ok');
    assert.equal(ok.provider, 'opencode');
    assert.deepEqual(tried, [[OPENCODE_USAGE_URL, 'Bearer a'], [OPENCODE_USAGE_URL, 'Bearer b']]);
    assert.match((await fetchOpenCodeStatus(acc, { env: {}, fetchImpl: async () => json(403, {}) })).message, /no Go subscription/);
    assert.equal((await fetchOpenCodeStatus(acc, { env: {}, fetchImpl: async () => json(401, {}) })).status, 'expired');
    let waited = 0;
    const limited = await fetchOpenCodeStatus(acc, { env: {}, now: () => 7, onRateLimit: (w) => { waited = w; }, fetchImpl: async () => json(429, {}) });
    assert.equal(limited.retryAt, 7 + waited);
    assert.equal((await fetchOpenCodeStatus(acc, { env: {}, fetchImpl: async () => json(200, {}) })).status, 'error');
    assert.match((await fetchOpenCodeStatus(acc, { env: {}, fetchImpl: async () => { throw new Error('offline'); } })).message, /offline/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

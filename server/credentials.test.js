import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshCredentials, readCredentials, OAUTH_TOKEN_URL, OAUTH_CLIENT_ID } from './credentials.js';

const NOW = 1_800_000_000_000;
function setup(oauth) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-'));
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth, other: { keep: 1 } }));
  return dir;
}
const stale = { accessToken: 'old', refreshToken: 'r1', expiresAt: NOW - 1000, scopes: ['user:profile', 'user:inference'], subscriptionType: 'team' };
const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const read = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'));
const opts = (fetchImpl) => ({ fetchImpl, now: () => NOW, retryMs: 0 });

test('renews an expired login and keeps every other field', async () => {
  const dir = setup(stale);
  let seen;
  const fresh = await refreshCredentials(dir, stale, opts(async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return ok({ access_token: 'new', refresh_token: 'r2', expires_in: 28800 })();
  }));
  assert.equal(seen.url, OAUTH_TOKEN_URL);
  assert.deepEqual(seen.body, { grant_type: 'refresh_token', refresh_token: 'r1', client_id: OAUTH_CLIENT_ID, scope: 'user:profile user:inference' });
  assert.equal(fresh.accessToken, 'new');
  const saved = read(dir);
  assert.equal(saved.claudeAiOauth.accessToken, 'new');
  assert.equal(saved.claudeAiOauth.refreshToken, 'r2');
  assert.equal(saved.claudeAiOauth.expiresAt, NOW + 28800 * 1000);
  assert.equal(saved.claudeAiOauth.subscriptionType, 'team');
  assert.deepEqual(saved.other, { keep: 1 });
  assert.equal((await readCredentials(dir)).accessToken, 'new');
});

test('keeps the old refresh token when none is returned', async () => {
  const dir = setup(stale);
  await refreshCredentials(dir, stale, opts(ok({ access_token: 'new', expires_in: 60 })));
  assert.equal(read(dir).claudeAiOauth.refreshToken, 'r1');
});

test('uses the file as is when Claude Code already renewed it', async () => {
  const dir = setup({ ...stale, accessToken: 'newer', expiresAt: NOW + 3_600_000 });
  let called = false;
  const fresh = await refreshCredentials(dir, stale, opts(async () => { called = true; return ok({})(); }));
  assert.equal(called, false);
  assert.equal(fresh.accessToken, 'newer');
});

test('does not overwrite a login rotated while the request was in flight', async () => {
  const dir = setup(stale);
  const fresh = await refreshCredentials(dir, stale, opts(async () => {
    fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { ...stale, accessToken: 'cc', refreshToken: 'r9', expiresAt: NOW + 3_600_000 } }));
    return ok({ access_token: 'mine', refresh_token: 'r2', expires_in: 60 })();
  }));
  assert.equal(fresh.accessToken, 'cc');
  assert.equal(read(dir).claudeAiOauth.accessToken, 'cc');
});

test('returns null on a refused refresh and backs off', async () => {
  const dir = setup(stale);
  let calls = 0;
  const bad = async () => { calls++; return { ok: false, status: 400, json: async () => ({}) }; };
  assert.equal(await refreshCredentials(dir, stale, { fetchImpl: bad, now: () => NOW }), null);
  assert.equal(await refreshCredentials(dir, stale, { fetchImpl: bad, now: () => NOW + 1000 }), null);
  assert.equal(calls, 1);
  assert.equal(read(dir).claudeAiOauth.refreshToken, 'r1');
});

test('returns null without a refresh token or credentials file, and never throws on network errors', async () => {
  const none = setup({ accessToken: 'a', expiresAt: NOW - 1 });
  assert.equal(await refreshCredentials(none, { accessToken: 'a' }, opts(ok({}))), null);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'creds-'));
  assert.equal(await refreshCredentials(empty, stale, opts(ok({}))), null);
  const dir = setup(stale);
  assert.equal(await refreshCredentials(dir, stale, opts(async () => { throw new Error('offline'); })), null);
});

test('concurrent calls share one request', async () => {
  const dir = setup(stale);
  let calls = 0;
  const f = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return ok({ access_token: 'n', expires_in: 60 })(); };
  const [a, b] = await Promise.all([refreshCredentials(dir, stale, opts(f)), refreshCredentials(dir, stale, opts(f))]);
  assert.equal(calls, 1);
  assert.equal(a.accessToken, b.accessToken);
});

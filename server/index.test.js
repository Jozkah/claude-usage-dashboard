import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.MOCK = '1';
process.env.NO_OPEN = '1';
const { start } = await import('./index.js');

let server;
let port;

before(async () => {
  server = await start({ port: 0, host: '127.0.0.1', scanner: false, desktopSync: false, openBrowser: false });
  port = server.address().port;
});
after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }));

function call(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

test('importing index.js did not listen; start() serves /api/usage in mock mode', async () => {
  const r = await call('GET', '/api/usage');
  assert.equal(r.status, 200);
  assert.equal(r.json.mock, true);
  assert.ok(Array.isArray(r.json.accounts) && r.json.accounts.length > 0);
  const a = r.json.accounts[0];
  assert.equal(a.status, 'ok');
  assert.ok(Array.isArray(a.windows) && a.windows.length > 0);
  assert.ok(Array.isArray(a.sessions));
});

test('/api/tokens adds today and timeZone', async () => {
  const r = await call('GET', '/api/tokens?days=3');
  assert.equal(r.status, 200);
  assert.match(r.json.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof r.json.timeZone, 'string');
  assert.equal(r.json.days.length, 3);
});

test('rejects unknown Host and cross-site Origin', async () => {
  assert.equal((await call('GET', '/api/usage', { headers: { Host: 'evil.example' } })).status, 403);
  const post = await call('POST', '/api/accounts', {
    headers: { ...JSON_HEADERS, Origin: 'http://evil.example' }, body: JSON.stringify({ name: 'x', configDir: '/x' }),
  });
  assert.equal(post.status, 403);
  const site = await call('DELETE', '/api/accounts/nope', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(site.status, 403);
});

test('mutating routes need JSON content type when a body is present, bodiless is fine', async () => {
  const wrong = await call('POST', '/api/accounts', { headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(wrong.status, 415);
  const bodiless = await call('POST', '/api/chats/sync-desktop');
  assert.equal(bodiless.status, 400); // mock mode: reached the route, not blocked by the guard
});

test('bad JSON is a 400, not a 500', async () => {
  const r = await call('POST', '/api/accounts', { headers: JSON_HEADERS, body: '{nope' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /JSON/);
});

test('code-setup sync is mock-blocked before body handling', async () => {
  const r = await call('POST', '/api/code-setup/sync', { headers: JSON_HEADERS, body: '{"sourceId":"a","targetId":"b"}' });
  assert.equal(r.status, 400);
});

test('/api/history validates params and supports since', async () => {
  const bad = ['key=nope', 'range=99y', 'since=abc', 'since=-5', 'since=1.5'];
  for (const q of bad) assert.equal((await call('GET', '/api/history?id=personal&' + q)).status, 400, q);
  const all = await call('GET', '/api/history?id=personal&key=five_hour&range=6h');
  assert.equal(all.status, 200);
  assert.ok(all.json.points.length > 2);
  const cut = all.json.points[all.json.points.length - 2][0];
  const newer = await call('GET', `/api/history?id=personal&key=five_hour&range=6h&since=${cut}`);
  assert.ok(newer.json.points.length >= 1 && newer.json.points.every((p) => p[0] > cut));
  assert.ok(newer.json.points.length < all.json.points.length);
});

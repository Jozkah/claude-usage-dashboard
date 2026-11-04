import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { normalizeHost, parseAllowedHosts, hostAllowed, originAllowed, tokenOk, parseJsonText, readBody, resolveStaticPath, writeFileAtomic, createInflight, guardMutation, HttpError } from './http-utils.js';

test('hosts are case-insensitive and ignore ports', () => {
  const allowed = parseAllowedHosts('MyPC, dash.lan:4777');
  assert.ok(hostAllowed('mypc:4777', allowed));
  assert.ok(hostAllowed('DASH.LAN', allowed));
  assert.ok(hostAllowed('localhost.', allowed));
  assert.ok(hostAllowed('[::1]:4777', allowed));
  assert.ok(!hostAllowed('evil.example', allowed));
  assert.equal(normalizeHost('[::1]'), '::1');
});

test('origin and token checks', () => {
  assert.ok(originAllowed({ host: 'localhost:4777' }));
  assert.ok(originAllowed({ host: 'localhost:4777', origin: 'http://localhost:4777', 'sec-fetch-site': 'same-origin' }));
  assert.ok(!originAllowed({ host: 'localhost:4777', 'sec-fetch-site': 'cross-site' }));
  assert.ok(!originAllowed({ host: 'localhost:4777', origin: 'http://evil.example' }));
  assert.ok(tokenOk({}, ''));
  assert.ok(!tokenOk({}, 'abc'));
  assert.ok(tokenOk({ 'x-dashboard-token': 'abc' }, 'abc'));
  assert.ok(tokenOk({ cookie: 'a=1; dashboard_token=abc' }, 'abc'));
});

test('json body parsing gives 400 for bad input', () => {
  for (const text of ['{', 'null', '[]', '5']) {
    assert.throws(() => parseJsonText(text), (e) => e instanceof HttpError && e.status === 400);
  }
  assert.deepEqual(parseJsonText(''), {});
  assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
});

test('readBody enforces a byte limit with 413', async () => {
  await assert.rejects(readBody(Readable.from([Buffer.alloc(50)]), 10), (e) => e.status === 413);
  assert.equal(await readBody(Readable.from([Buffer.from('héllo')]), 100), 'héllo');
});

test('static path resolution', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  try {
    const dist = path.join(base, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(base, 'dist-old'));
    fs.writeFileSync(path.join(dist, 'index.html'), 'x');
    fs.writeFileSync(path.join(dist, 'assets', 'a.js'), 'x');
    fs.writeFileSync(path.join(base, 'dist-old', 'x.txt'), 'x');
    assert.equal(resolveStaticPath(dist, '/').file, path.join(dist, 'index.html'));
    assert.equal(resolveStaticPath(dist, '/assets/a.js').status, 200);
    assert.equal(resolveStaticPath(dist, '/assets/missing.js').status, 404);
    assert.equal(resolveStaticPath(dist, '/some/route').file, path.join(dist, 'index.html'));
    assert.equal(resolveStaticPath(dist, '/%E0%A4%A').status, 400);
    assert.notEqual(resolveStaticPath(dist, '/../dist-old/x.txt').file, path.join(base, 'dist-old', 'x.txt'));
    assert.equal(resolveStaticPath(dist, '/../dist-old/x.txt').status, 404);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('atomic write replaces the file and leaves no temp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-'));
  try {
    const f = path.join(dir, 'c.json');
    writeFileAtomic(f, '1'); writeFileAtomic(f, '2');
    assert.equal(fs.readFileSync(f, 'utf8'), '2');
    assert.deepEqual(fs.readdirSync(dir), ['c.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('inflight shares one promise per key', async () => {
  const run = createInflight();
  let calls = 0;
  const job = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return calls; };
  const [a, b] = await Promise.all([run('k', job), run('k', job)]);
  assert.equal(a, 1); assert.equal(b, 1);
  await run('k', job);
  assert.equal(calls, 2);
});

test('tokenOk accepts Authorization: Bearer', () => {
  assert.ok(tokenOk({ authorization: 'Bearer abc' }, 'abc'));
  assert.ok(!tokenOk({ authorization: 'Bearer nope' }, 'abc'));
});

test('guardMutation: origin, token, content type', () => {
  const h = { host: 'localhost:4777' };
  assert.equal(guardMutation(h), null);
  assert.equal(guardMutation({ ...h, 'sec-fetch-site': 'cross-site' }).status, 403);
  assert.equal(guardMutation({ ...h, origin: 'http://evil.example' }).status, 403);
  assert.equal(guardMutation({ ...h, 'content-length': '2', 'content-type': 'text/plain' }).status, 415);
  assert.equal(guardMutation({ ...h, 'content-length': '2', 'content-type': 'application/json; charset=utf-8' }), null);
  assert.equal(guardMutation(h, { allowAnyHost: true }).status, 403);
  assert.equal(guardMutation(h, { token: 'x' }).status, 403);
  assert.equal(guardMutation({ ...h, authorization: 'Bearer x' }, { token: 'x', allowAnyHost: true }), null);
});

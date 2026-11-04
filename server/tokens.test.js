import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTokenStore, mockTokenReport } from './tokens.js';

const NOON = '2026-10-12T12:00:00';
const NOW = new Date(2026, 9, 12, 18).getTime();

function line(id, o = {}) {
  return JSON.stringify({
    type: 'assistant', timestamp: o.ts || NOON, cwd: o.cwd || '/work/app', requestId: o.req || 'r',
    message: {
      id, model: o.model || 'claude-sonnet-4-5',
      usage: { input_tokens: o.in ?? 10, output_tokens: o.out ?? 5, cache_read_input_tokens: o.cr ?? 0, cache_creation_input_tokens: o.cw ?? 0, ...o.usage },
    },
  });
}

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-tokens-'));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const sum = (rep) => rep.days.reduce((n, d) => n + d.total, 0);

test('blocks with one id keep the last numbers; id change commits; last message is reported', () => {
  const s = createTokenStore();
  const f = { offset: 0, pending: null };
  s.state.files.f = f;
  s.ingest(line('a', { out: 1 }), f);
  s.ingest(line('a', { out: 9 }), f);
  assert.equal(s.state.days['2026-10-12'], undefined);
  assert.equal(s.getReport(7, NOW).days[0].output, 9); // pending counted virtually
  s.ingest(line('b', { out: 2 }), f);
  assert.equal(s.state.days['2026-10-12'] !== undefined, true);
  const rep = s.getReport(7, NOW);
  assert.equal(rep.days[0].output, 11);
  assert.equal(rep.days[0].input, 20);
  assert.equal(s.state.days['2026-10-12'].u && Object.keys(s.state.days['2026-10-12'].u).length, 1);
  assert.equal(f.pending.out, 2); // report did not commit pending
});

test('same id in another file or later in the same file counts once', () => {
  const s = createTokenStore();
  const f1 = { offset: 0, pending: null };
  const f2 = { offset: 0, pending: null };
  s.ingest(line('a'), f1);
  s.ingest(line('b'), f1);
  s.ingest(line('a'), f1); // id reappears after another message
  s.ingest(line('c'), f1);
  s.ingest(line('a'), f2); // forked session copy
  s.ingest(line('b'), f2);
  s.state.files.f1 = f1; s.state.files.f2 = f2;
  assert.equal(s.getReport(7, NOW).days[0].input, 30); // a, b, c once each
});

test('cache split falls back to cache_creation_input_tokens; bad lines and zero/synthetic records are ignored', () => {
  const s = createTokenStore();
  const f = { offset: 0, pending: null };
  s.ingest(line('a', { in: 0, out: 0, cw: 100, usage: { cache_creation: { ephemeral_1h_input_tokens: 30 } } }), f);
  s.ingest('{not json "usage" "assistant"', f);
  s.ingest(line('t', { ts: 'garbage' }), f);
  s.ingest(line('z', { in: 0, out: 0 }), f);
  s.ingest(line('s', { model: '<synthetic>' }), f);
  s.ingest(line('d', { model: '<synthetic>', in: 0, out: 0 }), f);
  s.state.files.f = f;
  const rep = s.getReport(7, NOW);
  assert.equal(rep.days.length, 1);
  assert.equal(rep.days[0].cacheWrite, 100);
  assert.deepEqual(rep.days[0].models.map((m) => m.name), ['claude-sonnet-4-5']);
  // 70 x 5m (1.25) + 30 x 1h (2) at $3/M
  assert.ok(Math.abs(rep.days[0].cost - (70 * 3 * 1.25 + 30 * 3 * 2) / 1e6) < 1e-12);
});

test('cost is computed at report time: unpriced and dated base models', () => {
  const s = createTokenStore();
  const f = { offset: 0, pending: null };
  s.ingest(line('a', { model: 'claude-opus-4-20250514', in: 1e6, out: 0 }), f);
  s.ingest(line('b', { model: 'mystery-model', in: 100, out: 0 }), f);
  s.ingest(line('c', { model: 'claude-opus-4-20250514', in: 0, out: 0, cr: 1 }), f);
  s.state.files.f = f;
  const d = s.getReport(7, NOW).days[0];
  assert.equal(d.unpriced, 100);
  assert.ok(Math.abs(d.cost - 15) < 1e-3);
  assert.equal(d.models.find((m) => m.name === 'mystery-model').cost, 0);
});

test('long-context requests are priced per request, not per day total', () => {
  const s = createTokenStore();
  const f = { offset: 0, pending: null };
  s.ingest(line('a', { in: 250000, out: 0 }), f); // long: $6/M
  s.ingest(line('b', { in: 100000, out: 0 }), f); // normal: $3/M
  s.state.files.f = f;
  assert.ok(Math.abs(s.getReport(7, NOW).days[0].cost - (1.5 + 0.3)) < 1e-9);
});

test('scan: partial last line waits for newline, multi-byte chars survive tiny chunks', async () => {
  const t = tmp();
  try {
    const file = path.join(t.dir, 'a.jsonl');
    const s = createTokenStore({ chunkSize: 16 });
    const l1 = line('a', { cwd: '/work/pröjekt-日本' });
    const l2 = line('b');
    fs.writeFileSync(file, l1 + '\n' + l2.slice(0, 20));
    await s.scanOnce(() => [t.dir]);
    assert.equal(s.state.files[file].offset, Buffer.byteLength(l1 + '\n'));
    fs.appendFileSync(file, l2.slice(20) + '\n');
    await s.scanOnce(() => [t.dir]);
    const rep = s.getReport(7, NOW);
    assert.equal(rep.days[0].input, 20);
    assert.equal(rep.days[0].projects.some((p) => p.name === 'pröjekt-日本'), true);
    assert.equal(rep.ready, true);
  } finally { t.done(); }
});

test('shrunk or rewritten file is re-read without double counting', async () => {
  const t = tmp();
  try {
    const file = path.join(t.dir, 'a.jsonl');
    const s = createTokenStore();
    fs.writeFileSync(file, [line('a'), line('b'), line('c')].join('\n') + '\n');
    await s.scanOnce(() => [t.dir]);
    assert.equal(s.getReport(7, NOW).days[0].input, 30);
    // shrink: only d is new; a..c already counted
    fs.writeFileSync(file, line('d') + '\n');
    await s.scanOnce(() => [t.dir]);
    assert.equal(s.getReport(7, NOW).days[0].input, 40);
    // larger rewrite with different head
    fs.writeFileSync(file, [line('e', { cwd: '/other/zzzzzzzzzzzzzzzzzzzzzzzz' }), line('f'), line('g'), line('h')].join('\n') + '\n');
    await s.scanOnce(() => [t.dir]);
    assert.equal(s.getReport(7, NOW).days[0].input, 80);
  } finally { t.done(); }
});

test('deleted logs are forgotten but their totals stay; state persists and version mismatch rescans', async () => {
  const t = tmp();
  try {
    const keep = path.join(t.dir, 'keep.jsonl');
    const gone = path.join(t.dir, 'gone.jsonl');
    const stateFile = path.join(t.dir, 'state.json');
    fs.writeFileSync(keep, line('a') + '\n');
    fs.writeFileSync(gone, line('b') + '\n');
    const s = createTokenStore();
    s.load(stateFile);
    await s.scanOnce(() => [t.dir]);
    fs.rmSync(gone);
    await s.scanOnce(() => [t.dir]);
    assert.deepEqual(Object.keys(s.state.files), [keep]);
    assert.equal(s.getReport(7, NOW).days[0].input, 20);

    const reload = createTokenStore();
    reload.load(stateFile);
    assert.equal(reload.getReport(7, NOW).days[0].input, 20);
    await reload.scanOnce(() => [t.dir]);
    assert.equal(reload.getReport(7, NOW).days[0].input, 20); // nothing re-counted

    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    fs.writeFileSync(stateFile, JSON.stringify({ ...saved, v: 3 }));
    const old = createTokenStore();
    old.load(stateFile);
    assert.equal(sum(old.getReport(7, NOW)), 0);
    assert.equal(old.progress.ready, false);
  } finally { t.done(); }
});

test('report window uses calendar days across a DST change', () => {
  const s = createTokenStore();
  const f = { offset: 0, pending: null };
  s.ingest(line('a', { ts: '2026-03-01T12:00:00' }), f);
  s.ingest(line('b', { ts: '2026-03-15T12:00:00' }), f);
  s.ingest(line('c', { ts: '2026-03-16T12:00:00' }), f);
  s.state.files.f = f;
  // 00:30 local on 2026-03-16, 14-day window = Mar 3..16 whatever the DST offset
  const now = new Date(2026, 2, 16, 0, 30).getTime();
  assert.deepEqual(s.getReport(14, now).days.map((d) => d.date), ['2026-03-16', '2026-03-15']);
  assert.equal(s.getReport(1, now).days.length, 1);
});

test('mock report returns the requested number of consecutive days', () => {
  const rep = mockTokenReport(5);
  assert.equal(rep.days.length, 5);
  assert.equal(new Set(rep.days.map((d) => d.date)).size, 5);
});

test('same-size rewrite with identical head is detected by the tail fingerprint', async () => {
  const t = tmp();
  try {
    const file = path.join(t.dir, 'a.jsonl');
    const s = createTokenStore();
    fs.writeFileSync(file, [line('a'), line('b'), line('c')].join('\n') + '\n');
    await s.scanOnce(() => [t.dir]);
    assert.equal(s.getReport(7, NOW).days[0].input, 30);
    const size = fs.statSync(file).size;
    // same byte length, same first line, last line differs only in cache_read (inside the tail window)
    fs.writeFileSync(file, [line('a'), line('b'), line('d', { cr: 5 })].join('\n') + '\n');
    assert.equal(fs.statSync(file).size, size);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    await s.scanOnce(() => [t.dir]);
    assert.equal(s.getReport(7, NOW).days[0].input, 40); // a,b,c once each, d added, nothing doubled
  } finally { t.done(); }
});

test('unchanged size and mtime are not re-read; directory listing is cached by dir mtime', async () => {
  const t = tmp();
  try {
    const file = path.join(t.dir, 'a.jsonl');
    const s = createTokenStore();
    fs.writeFileSync(file, line('a') + '\n');
    await s.scanOnce(() => [t.dir]);
    const f = s.state.files[file];
    f.head = 'AAAA'; // would force a reset if the signature were checked
    await s.scanOnce(() => [t.dir]);
    assert.equal(f.offset > 0, true);
    assert.equal(s.getReport(7, NOW).days[0].input, 10);
    // a new file in the same directory changes the dir mtime and is picked up
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(t.dir, 'b.jsonl'), line('b') + '\n');
    fs.utimesSync(t.dir, later, later);
    await s.scanOnce(() => [t.dir]);
    assert.equal(s.getReport(7, NOW).days[0].input, 20);
  } finally { t.done(); }
});

test('large state is written in chunks and reloads identically', async () => {
  const t = tmp();
  try {
    const stateFile = path.join(t.dir, 'state.json');
    const s = createTokenStore();
    s.load(stateFile);
    for (let i = 0; i < 40000; i++) s.state.files[`/logs/${i}-${'x'.repeat(40)}.jsonl`] = { offset: i, pending: null, head: 'abc', tail: 'def' };
    s.state.days['2026-10-12'] = { u: { '["claude-sonnet-4-5","app","","","",0]': [10, 5, 0, 0, 0, 0] } };
    await s.scanOnce(() => [t.dir]); // empty root: files kept (nothing walked), state saved
    const text = fs.readFileSync(stateFile, 'utf8');
    assert.ok(text.length > 2 * (1 << 20));
    const j = JSON.parse(text);
    assert.equal(Object.keys(j.files).length, 40000);
    const r = createTokenStore();
    r.load(stateFile);
    assert.equal(r.getReport(7, NOW).days[0].input, 10);
  } finally { t.done(); }
});

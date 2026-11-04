import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createUsageSnapshot } from './usage-snapshot.js';

test('persists last successful usage without credentials and restores it after restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-snapshot-'));
  try {
    const file = path.join(dir, 'latest.json');
    const account = { id: 'work', name: 'Work', configDir: '~/.claude-work' };
    const success = {
      ...account, status: 'ok', fetchedAt: 1234, plan: 'Max 5x',
      windows: [
        { key: 'five_hour', label: '5-hour session', used: 42, resetsAt: '2026-10-12T15:00:00Z' },
        { key: 'seven_day', label: 'Weekly · all models', used: 100, resetsAt: '2026-10-14T07:00:00Z' },
      ],
      raw: { secret: 'must not persist' },
    };
    createUsageSnapshot(file).remember(account, success);
    createUsageSnapshot(file).deferUntil(account, Date.parse('2026-11-04T07:00:00Z'));
    const saved = fs.readFileSync(file, 'utf8');
    assert.equal(saved.includes('secret'), false);

    const snapshots = createUsageSnapshot(file);
    assert.equal(snapshots.peek(account).nextPollAt, Date.parse('2026-11-04T07:00:00Z'));
    const stale = snapshots.fallback(account, { ...account, status: 'no_login', message: 'No login found.' });
    assert.equal(stale.authStatus, 'no_login');
    assert.equal(stale.status, 'ok');
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, 1234);
    assert.equal(stale.nextPollAt, Date.parse('2026-11-04T07:00:00Z'));
    assert.deepEqual(stale.windows.map((window) => window.key), ['seven_day']);
    assert.deepEqual(snapshots.peek(account).windows.map((window) => window.key), ['seven_day']);
    assert.match(stale.staleMessage, /No login found/);
    assert.equal(snapshots.fallback({ ...account, configDir: '~/.other' }, { status: 'error' }).status, 'error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recovers last readings from existing history when no snapshot exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-history-'));
  try {
    const snapshots = createUsageSnapshot(path.join(dir, 'latest.json'));
    const account = { id: 'work', configDir: '~/.claude-work' };
    snapshots.seedFromHistory(account, {
      five_hour: [[1000, 15], [2000, 27]],
      seven_day: [[1500, 49]],
      unknown: [[3000, 99]],
    }, { five_hour: '5-hour session', seven_day: 'Weekly · all models' });
    const stale = createUsageSnapshot(path.join(dir, 'latest.json')).fallback(account, { status: 'error', message: 'Offline' });
    assert.equal(stale.fetchedAt, 2000);
    assert.deepEqual(stale.windows.map((w) => [w.key, w.used, w.resetsAt]), [
      ['five_hour', 27, null], ['seven_day', 49, null],
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seeded snapshot honours the supplied plan and flags unknown plan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-seed-'));
  try {
    const file = path.join(dir, 'latest.json');
    const history = { five_hour: [[1000, 15]], seven_day: [[1500, 49]] };
    const labels = { five_hour: '5-hour session', seven_day: 'Weekly' };
    const max = { id: 'max', configDir: '~/.m' };
    const other = { id: 'other', configDir: '~/.o' };
    const snapshots = createUsageSnapshot(file);
    snapshots.seedFromHistory(max, history, labels, 'Max 5x');
    snapshots.seedFromHistory(other, history, labels);
    const again = createUsageSnapshot(file);
    assert.deepEqual(again.peek(max).windows.map((w) => w.key), ['seven_day']);
    assert.equal(again.peek(max).planUnknown, undefined);
    assert.deepEqual(again.fallback(max, { status: 'error' }).windows.map((w) => w.key), ['seven_day']);
    assert.equal(again.peek(other).planUnknown, true);
    assert.equal(again.peek(other).windows.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cached windows past their reset time are flagged expired', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-expired-'));
  try {
    const file = path.join(dir, 'latest.json');
    const account = { id: 'a', configDir: '~/.a' };
    const windows = [
      { key: 'five_hour', used: 100, resetsAt: '2026-10-12T15:00:00Z' },
      { key: 'seven_day', used: 40, resetsAt: '2026-10-20T00:00:00Z' },
      { key: 'x', used: 1, resetsAt: null },
    ];
    createUsageSnapshot(file).remember(account, { status: 'ok', fetchedAt: 1, plan: 'Pro', windows });
    const at = Date.parse('2026-10-15T00:00:00Z');
    const snapshots = createUsageSnapshot(file, { now: () => at });
    assert.deepEqual(snapshots.peek(account).windows.map((w) => w.expired), [true, undefined, undefined]);
    assert.deepEqual(snapshots.fallback(account, { status: 'error' }).windows.map((w) => w.expired), [true, undefined, undefined]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('forget, remember guards, deferUntil no-op, corrupt files and configDir mismatch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-misc-'));
  try {
    const file = path.join(dir, 'latest.json');
    const account = { id: 'a', configDir: '~/.a' };
    const ok = { status: 'ok', fetchedAt: 1, windows: [{ key: 'seven_day', used: 1, resetsAt: null }] };
    const s = createUsageSnapshot(file);
    s.remember(account, { ...ok, status: 'error' });
    s.remember(account, { ...ok, windows: [] });
    s.remember(account, { ...ok, windows: undefined });
    assert.equal(s.peek(account), null);
    assert.equal(fs.existsSync(file), false);
    s.remember(account, ok);
    assert.equal(s.peek({ ...account, configDir: '~/.b' }), null);
    s.deferUntil(account, 5);
    const mtime = fs.statSync(file).mtimeMs;
    s.deferUntil(account, 5);
    assert.equal(fs.statSync(file).mtimeMs, mtime);
    s.forget(account.id);
    s.forget('missing');
    assert.equal(createUsageSnapshot(file).peek(account), null);
    fs.writeFileSync(file, '[1,2]');
    assert.equal(createUsageSnapshot(file).peek(account), null);
    fs.writeFileSync(file, '{not json');
    assert.equal(createUsageSnapshot(file).peek(account), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

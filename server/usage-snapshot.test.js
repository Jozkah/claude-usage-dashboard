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
      windows: [{ key: 'five_hour', label: '5-hour session', used: 42, resetsAt: '2026-10-12T15:00:00Z' }],
      raw: { secret: 'must not persist' },
    };
    createUsageSnapshot(file).remember(account, success);
    const saved = fs.readFileSync(file, 'utf8');
    assert.equal(saved.includes('secret'), false);

    const snapshots = createUsageSnapshot(file);
    const stale = snapshots.fallback(account, { ...account, status: 'no_login', message: 'No login found.' });
    assert.equal(stale.status, 'ok');
    assert.equal(stale.stale, true);
    assert.equal(stale.fetchedAt, 1234);
    assert.equal(stale.windows[0].used, 42);
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

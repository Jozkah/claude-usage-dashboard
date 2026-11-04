import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeAccounts, uniqueIds, validateConfigDir, sanitizeHistory, historyPoints, sessionFileFresh, credentialsExpired } from './account-utils.js';

test('normalizeAccounts drops malformed and duplicate entries', () => {
  const good = { id: 'a', name: 'A', configDir: '/x' };
  const { accounts, dropped } = normalizeAccounts([good, null, 'x', { id: 'x', name: 'X' }, { ...good }]);
  assert.deepEqual(accounts, [good]);
  assert.equal(dropped.length, 4);
});

test('uniqueIds suffixes collisions', () => {
  assert.deepEqual(uniqueIds([{ id: 'work' }, { id: 'work' }, { id: 'work' }]).map((e) => e.id), ['work', 'work-2', 'work-3']);
});

test('validateConfigDir requires an existing, new directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  try {
    assert.equal(validateConfigDir(dir), path.resolve(dir));
    assert.throws(() => validateConfigDir(path.join(dir, 'nope')), /does not exist/);
    assert.throws(() => validateConfigDir(dir, [dir]), /already added/);
    const file = path.join(dir, 'f'); fs.writeFileSync(file, '');
    assert.throws(() => validateConfigDir(file), /directory/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('history sanitising and safe lookup', () => {
  assert.deepEqual(Object.keys(sanitizeHistory(null)), []);
  const h = sanitizeHistory({ a: { five_hour: [[1, 2], 'bad', [3]] }, b: 5 });
  assert.deepEqual(historyPoints(h, 'a', 'five_hour'), [[1, 2]]);
  assert.deepEqual(historyPoints(h, 'a', 'constructor'), []);
  assert.deepEqual(historyPoints(h, '__proto__', 'x'), []);
});

test('session freshness and credential expiry', () => {
  const now = 1e9;
  assert.ok(sessionFileFresh(5, now - 1000, now));
  assert.ok(!sessionFileFresh(0, now, now));
  assert.ok(!sessionFileFresh(5, now - 48 * 3600e3, now));
  assert.ok(credentialsExpired({ expiresAt: now - 1 }, now));
  assert.ok(!credentialsExpired({ expiresAt: now + 1 }, now));
  assert.ok(!credentialsExpired({}, now));
});

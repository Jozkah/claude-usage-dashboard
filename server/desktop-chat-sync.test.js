import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncDesktopSessionRecords } from './desktop-chat-sync.js';

test('copies missing Desktop records both ways and preserves existing records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-sync-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    const p = path.join(personal, 'claude-code-sessions', 'personal-account', 'device');
    const w = path.join(work, 'claude-code-sessions', 'work-account', 'device');
    fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(w, { recursive: true });
    fs.writeFileSync(path.join(p, 'local_abc.json'), 'personal');
    fs.writeFileSync(path.join(w, 'local_def.json'), 'work');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 1, toPersonal: 1 });
    assert.equal(fs.readFileSync(path.join(w, 'local_abc.json'), 'utf8'), 'personal');
    assert.equal(fs.readFileSync(path.join(p, 'local_def.json'), 'utf8'), 'work');
    fs.writeFileSync(path.join(p, 'local_abc.json'), 'changed');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 0 });
    assert.equal(fs.readFileSync(path.join(w, 'local_abc.json'), 'utf8'), 'personal');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

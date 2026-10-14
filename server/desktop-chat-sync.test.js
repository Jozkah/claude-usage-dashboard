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
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"title":"personal"}');
    fs.writeFileSync(path.join(w, 'local_def.json'), '{"title":"work"}');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 1, toPersonal: 1, conflicts: 0 });
    assert.equal(fs.readFileSync(path.join(w, 'local_abc.json'), 'utf8'), '{"title":"personal"}');
    assert.equal(fs.readFileSync(path.join(p, 'local_def.json'), 'utf8'), '{"title":"work"}');
    fs.writeFileSync(path.join(w, 'local_123abc.json'), '{"title":"new work session"}');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 1, conflicts: 0 });
    assert.equal(fs.readFileSync(path.join(p, 'local_123abc.json'), 'utf8'), '{"title":"new work session"}');
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"title":"changed"}');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 0, conflicts: 1 });
    assert.equal(fs.readFileSync(path.join(w, 'local_abc.json'), 'utf8'), '{"title":"personal"}');
    fs.writeFileSync(path.join(p, 'local_bad.json'), '{"title":');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 0, conflicts: 1 });
    assert.equal(fs.existsSync(path.join(w, 'local_bad.json')), false);
    assert.equal(fs.readdirSync(w).some((name) => name.startsWith('.sync-')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('live imported Desktop session is not duplicated by background sync', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-import-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    const p = path.join(personal, 'claude-code-sessions', 'personal-account', 'device');
    const w = path.join(work, 'claude-code-sessions', 'work-account', 'device');
    fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(w, { recursive: true });
    fs.writeFileSync(path.join(w, 'local_original.json'), JSON.stringify({ cliSessionId: 'abc-123' }));
    fs.writeFileSync(path.join(p, 'local_abc-123.json'), JSON.stringify({ cliSessionId: 'abc-123', adoptedFromOtherSurface: true }));
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 0, conflicts: 0 });
    assert.deepEqual(fs.readdirSync(p), ['local_abc-123.json']);
    assert.deepEqual(fs.readdirSync(w), ['local_original.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

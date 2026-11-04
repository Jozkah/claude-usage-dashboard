import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackup, listBackups, backupsDir, moveToTrash } from './sync-support.js';

test('backups land in the state dir backups folder, are unique and pruned', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sync-support-'));
  try {
    const state = path.join(root, 'state');
    const file = path.join(root, 'config.json');
    fs.writeFileSync(file, '{}');
    const made = new Set();
    for (let i = 0; i < 9; i++) made.add(createBackup(file, 'x', { keep: 3, stateDir: state }));
    assert.equal(made.size, 9); // same-millisecond writes get distinct names
    const kept = listBackups(file, 'x', { stateDir: state });
    assert.equal(kept.length, 3);
    assert.ok(kept.every((name) => name.startsWith(backupsDir(state))));
    assert.deepEqual(fs.readdirSync(root).sort(), ['config.json', 'state']);
    // Directories are backed up too, and a second file with the same name does not collide.
    const dir = path.join(root, 'sub', 'config.json');
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, '{"other":1}');
    createBackup(dir, 'x', { stateDir: state });
    assert.equal(listBackups(file, 'x', { stateDir: state }).length, 3);
    assert.equal(listBackups(dir, 'x', { stateDir: state }).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('moveToTrash keeps the content and removes the original', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sync-trash-'));
  try {
    const file = path.join(root, 'local_a.json');
    fs.writeFileSync(file, 'data');
    const moved = moveToTrash(file, 'chats', { stateDir: path.join(root, 'state') });
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readFileSync(moved, 'utf8'), 'data');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shareLocalChats } from './chat-sharing.js';

test('shares local chats, preserves separate account roots, and is idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-chat-share-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    fs.mkdirSync(path.join(personal, 'projects'), { recursive: true });
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(personal, 'projects', 'chat.jsonl'), 'chat');
    fs.writeFileSync(path.join(personal, '.credentials.json'), 'personal');
    fs.writeFileSync(path.join(work, '.credentials.json'), 'work');
    assert.deepEqual(shareLocalChats(personal, work), { alreadyShared: false });
    assert.equal(fs.readFileSync(path.join(work, 'projects', 'chat.jsonl'), 'utf8'), 'chat');
    assert.deepEqual(shareLocalChats(personal, work), { alreadyShared: true });
    assert.equal(fs.readFileSync(path.join(work, '.credentials.json'), 'utf8'), 'work');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('never replaces target chats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-chat-share-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    fs.mkdirSync(path.join(personal, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(work, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(work, 'projects', 'mine.jsonl'), 'x');
    assert.throws(() => shareLocalChats(personal, work), /Existing chats were left untouched/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('replaces an empty target projects folder, rejects bad folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-chat-share-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    fs.mkdirSync(path.join(personal, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(work, 'projects'), { recursive: true });
    assert.deepEqual(shareLocalChats(personal, work), { alreadyShared: false });
    assert.throws(() => shareLocalChats(personal, path.join(root, 'missing')), /does not exist/);
    assert.throws(() => shareLocalChats(path.join(root, 'missing'), work), /no local Claude Code chats/);
    assert.throws(() => shareLocalChats(personal, personal), /two different/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reports a dangling projects link clearly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-chat-share-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    fs.mkdirSync(path.join(personal, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(work, 'gone'), { recursive: true });
    fs.mkdirSync(work, { recursive: true });
    try { fs.symlinkSync(path.join(work, 'gone'), path.join(work, 'projects'), 'junction'); } catch { return; }
    fs.rmSync(path.join(work, 'gone'), { recursive: true });
    assert.throws(() => shareLocalChats(personal, work), /broken link/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importVscodeChats, findVscodeTranscripts } from './vscode-chat-import.js';
import { organizeDesktopFolders } from './desktop-folder-organizer.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function transcript(file, id, entrypoint, cwd, prompt) {
  const rows = [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] }, timestamp: '2026-07-13T02:52:14.139Z', entrypoint, cwd, sessionId: id, permissionMode: 'auto' },
    { type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [] }, timestamp: '2026-07-13T02:53:00.000Z', entrypoint, cwd, sessionId: id },
    { type: 'ai-title', sessionId: id, aiTitle: `Title of ${prompt}` },
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  fs.utimesSync(file, new Date('2026-07-13'), new Date('2026-07-13'));
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-import-'));
  const configDir = path.join(root, 'cfg');
  const profile = path.join(root, 'profile');
  const leaf = path.join(profile, 'claude-code-sessions', 'acct', 'device');
  fs.mkdirSync(leaf, { recursive: true });
  const dir = (name) => path.join(configDir, 'projects', name);
  transcript(path.join(dir('C--Code-Alpha'), `${A}.jsonl`), A, 'claude-vscode', 'C:\\Code\\Alpha', 'fix alpha');
  transcript(path.join(dir('C--Code-Beta'), `${B}.jsonl`), B, 'claude-vscode', 'C:\\Code\\Beta', 'fix beta');
  transcript(path.join(dir('C--Code-Alpha'), `${C}.jsonl`), C, 'claude-desktop', 'C:\\Code\\Alpha', 'desktop chat');
  return { root, configDir, profile, leaf, stateDir: path.join(root, 'state') };
}

test('finds only VS Code extension transcripts', () => {
  const { root, configDir } = setup();
  try {
    const found = findVscodeTranscripts(configDir);
    assert.deepEqual(found.map((item) => item.cliSessionId).sort(), [A, B]);
    const alpha = found.find((item) => item.cliSessionId === A);
    assert.equal(alpha.title, 'Title of fix alpha');
    assert.equal(alpha.cwd, 'C:\\Code\\Alpha');
    assert.equal(alpha.model, 'claude-sonnet-5-5');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('imports each VS Code chat once and never again after it is removed', () => {
  const { root, configDir, profile, leaf, stateDir } = setup();
  try {
    assert.equal(importVscodeChats(profile, { configDir, stateDir }).imported, 2);
    const pointer = JSON.parse(fs.readFileSync(path.join(leaf, `local_${A}.json`), 'utf8'));
    assert.equal(pointer.cliSessionId, A);
    assert.equal(pointer.sessionId, `local_${A}`);
    assert.equal(pointer.adoptedFrom, 'vscode');
    assert.equal(importVscodeChats(profile, { configDir, stateDir }).imported, 0);
    fs.rmSync(path.join(leaf, `local_${A}.json`));
    assert.equal(importVscodeChats(profile, { configDir, stateDir }).imported, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('skips chats Desktop already lists and chats still being written', () => {
  const { root, configDir, profile, leaf, stateDir } = setup();
  try {
    fs.writeFileSync(path.join(leaf, 'local_aaaa.json'), JSON.stringify({ sessionId: 'local_aaaa', cliSessionId: A }));
    fs.utimesSync(path.join(configDir, 'projects', 'C--Code-Beta', `${B}.jsonl`), new Date(), new Date());
    assert.equal(importVscodeChats(profile, { configDir, stateDir }).imported, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('VS Code chats are grouped by folder name, reusing a group of that name', () => {
  const record = (id, cwd, extra = {}) => ({ value: { sessionId: id, cwd, originCwd: cwd, ...extra } });
  const snapshot = { groups: [{ id: 'g-alpha', name: 'alpha', mode: 'code' }], assignments: [], order: [['g-alpha', []]], manuals: [{ id: 'g-alpha', kind: 'manual', v: 2, name: 'alpha', order: 0, members: [] }], known: [] };
  const participants = [{ records: new Map([
    ['a', record('local_a', 'C:\\Code\\Alpha', { adoptedFrom: 'vscode' })],
    ['b', record('local_b', 'C:\\Code\\Beta', { adoptedFrom: 'vscode' })],
    ['c', record('local_c', 'C:\\Code\\Beta', { adoptedFrom: 'vscode' })],
    ['d', record('local_d', 'C:\\Code\\Other')],
  ]) }];
  const { snapshot: result, vscode, vscodeGroups } = organizeDesktopFolders(snapshot, participants);
  const assigned = new Map(result.assignments);
  assert.equal(vscode, 3);
  assert.equal(vscodeGroups, 1);
  assert.equal(assigned.get('code:local_a'), 'g-alpha');
  const beta = result.groups.find((group) => group.name === 'Beta');
  assert.ok(beta);
  assert.equal(assigned.get('code:local_b'), beta.id);
  assert.equal(assigned.get('code:local_c'), beta.id);
  assert.equal(assigned.has('code:local_d'), false);
  assert.ok(result.manuals.some((manual) => manual.id === beta.id));
});

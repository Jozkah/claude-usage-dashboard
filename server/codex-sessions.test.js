import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodexSessionReader, turnState } from './codex-sessions.js';

const ID_A = '01a18fa6-0434-73f0-acce-50cdd494505a';
const ID_B = '01a1a3f8-3731-73c0-8565-1e131d86a672';
const ID_C = '01a1a62f-d7c8-7a21-a1ea-d0f2fb760f8c';
const NOW = 1_800_000_000_000;

function rollout(home, day, id, events, { cwd = String.raw`C:\Users\me\Coding\my-app`, ageMs = 1000 } = {}) {
  const dir = path.join(home, 'sessions', ...day.split('-'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-${day}T01-00-00-${id}.jsonl`);
  const lines = [JSON.stringify({ type: 'session_meta', payload: { id, cwd, base_instructions: 'x'.repeat(2000) } }),
    ...events.map((type) => JSON.stringify({ type: 'event_msg', payload: { type } }))];
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const t = new Date(NOW - ageMs);
  fs.utimesSync(file, t, t);
  return file;
}

test('turnState follows the last task event', () => {
  const ev = (t) => JSON.stringify({ type: 'event_msg', payload: { type: t } });
  assert.equal(turnState([ev('task_started'), ev('item_completed')].join('\n')), 'busy');
  assert.equal(turnState([ev('task_started'), ev('task_complete')].join('\n')), 'waiting');
  assert.equal(turnState([ev('task_complete'), ev('task_started')].join('\n')), 'busy');
  assert.equal(turnState(''), 'waiting');
});

test('lists recently active threads with names, folders and working state, newest first', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sess-'));
  try {
    rollout(home, '2026-10-31', ID_A, ['task_started', 'item_completed'], { ageMs: 5_000 }); // long-lived thread in an old day folder
    rollout(home, '2026-11-04', ID_B, ['task_started', 'task_complete'], { ageMs: 60_000 });
    rollout(home, '2026-11-01', ID_C, ['task_started'], { ageMs: 3 * 3600_000 }); // too old
    fs.writeFileSync(path.join(home, 'session_index.jsonl'),
      [{ id: ID_A, thread_name: 'Fix the importer' }, { id: ID_B, thread_name: 'Guardian review' }].map((j) => JSON.stringify(j)).join('\n') + '\nnot json\n');
    const list = await createCodexSessionReader({ now: () => NOW })(home);
    assert.deepEqual(list.map((s) => [s.id, s.name, s.folder, s.working, s.state]), [
      [ID_A, 'Fix the importer', 'my-app', true, 'busy'],
      [ID_B, 'Guardian review', 'my-app', false, 'waiting'],
    ]);
    assert.ok(list[0].lastActiveAt > list[1].lastActiveAt);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a started task in a file untouched for minutes is not shown as working; missing folders give an empty list', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-sess-'));
  try {
    rollout(home, '2026-11-04', ID_A, ['task_started'], { ageMs: 10 * 60_000 });
    const read = createCodexSessionReader({ now: () => NOW });
    assert.equal((await read(home))[0].working, false);
    assert.deepEqual(await createCodexSessionReader({ now: () => NOW })(path.join(home, 'nope')), []);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

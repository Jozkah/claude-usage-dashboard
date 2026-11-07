import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionReader } from './sessions.js';

test('limit-paused Desktop session remains visible when Claude marks it idle', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-session-'));
  const dir = path.join(root, 'sessions');
  const id = '266a5e72-9522-43d1-b68e-8609773e64d2';
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '123.json'), JSON.stringify({ pid: 123, sessionId: id, name: 'Review', status: 'idle' }));
  const read = createSessionReader({ alive: () => true });
  try {
    assert.deepEqual(await read(root), []);
    const [session] = await read(root, new Map([[id, Date.now() + 60_000]]));
    assert.equal(session.state, 'paused');
    assert.equal(session.working, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

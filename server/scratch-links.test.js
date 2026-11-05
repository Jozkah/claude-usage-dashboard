import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { linkScratchWorkspaces } from './scratch-links.js';

function record(profile, name, cwd) {
  const dir = path.join(profile, 'claude-code-sessions', 'acct', 'org');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `local_${name}.json`), JSON.stringify({ sessionId: `local_${name}`, cwd, originCwd: cwd, title: 'x'.repeat(5000) }));
}

test('a scratch folder missing for another profile is linked to the real one; existing paths are left alone', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-links-'));
  try {
    const a = path.join(home, 'A');
    const b = path.join(home, 'B');
    const real = path.join(a, 'scratch-workspaces', 'u1', 'u2', 'scratch-2026-10-26-420c0a');
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, 'note.txt'), 'hi');
    const wanted = path.join(b, 'scratch-workspaces', 'u1', 'u2', 'scratch-2026-10-26-420c0a');
    record(a, 's1', real);
    record(b, 's1', wanted);
    record(b, 's2', path.join(home, 'Projects', 'scratch-2026-01-01-abcdef')); // folder is gone everywhere
    record(b, 's3', path.join(home, 'Projects', 'my-app')); // not a scratch folder: ignored

    assert.deepEqual(linkScratchWorkspaces({ a, b }, { home }), { linked: 1, created: 1 });
    assert.equal(fs.readFileSync(path.join(wanted, 'note.txt'), 'utf8'), 'hi');
    assert.deepEqual(linkScratchWorkspaces({ a, b }, { home }), { linked: 0, created: 0 }); // nothing more to do
    assert.equal(fs.existsSync(path.join(home, 'Projects', 'scratch-2026-01-01-abcdef')), true);
    assert.equal(fs.existsSync(path.join(home, 'Projects', 'my-app')), false);
    assert.equal(fs.existsSync(real), true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('links are never created outside the home folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-links-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-elsewhere-'));
  try {
    const a = path.join(home, 'A');
    const real = path.join(a, 'scratch-workspaces', 'u1', 'u2', 'scratch-2026-10-26-420c0a');
    fs.mkdirSync(real, { recursive: true });
    const outside = path.join(elsewhere, 'scratch-2026-10-26-420c0a');
    record(a, 's1', outside);
    assert.deepEqual(linkScratchWorkspaces({ a }, { home }), { linked: 0, created: 0 });
    assert.equal(fs.existsSync(outside), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(elsewhere, { recursive: true, force: true }); }
});

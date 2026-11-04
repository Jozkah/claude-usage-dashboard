import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncAllAccounts } from './account-sync.js';

function make(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-sync-'));
  const dirs = Object.fromEntries(names.map((n) => [n, path.join(root, n)]));
  for (const d of Object.values(dirs)) fs.mkdirSync(path.join(d, 'plugins'), { recursive: true });
  return { root, dirs, accounts: names.map((n) => ({ id: n, name: n, configDir: dirs[n] })) };
}
const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('merges skills, commands and agents into a union and links chats to the hub', () => {
  const { root, dirs, accounts } = make(['hub', 'work', 'extra']);
  try {
    put(path.join(dirs.hub, 'projects', 'p1', 'a.jsonl'));
    put(path.join(dirs.hub, 'skills', 'hub-skill', 'SKILL.md'));
    put(path.join(dirs.hub, 'commands', 'hub-cmd.md'));
    put(path.join(dirs.work, 'skills', 'work-skill', 'SKILL.md'));
    put(path.join(dirs.extra, 'agents', 'extra-agent.md'));
    const out = syncAllAccounts(accounts, { stateDir: path.join(root, 'state') });
    assert.equal(out.hub, 'hub');
    for (const name of ['hub', 'work', 'extra']) {
      assert.ok(fs.existsSync(path.join(dirs[name], 'skills', 'hub-skill', 'SKILL.md')), `${name} hub-skill`);
      assert.ok(fs.existsSync(path.join(dirs[name], 'skills', 'work-skill', 'SKILL.md')), `${name} work-skill`);
      assert.ok(fs.existsSync(path.join(dirs[name], 'commands', 'hub-cmd.md')), `${name} command`);
      assert.ok(fs.existsSync(path.join(dirs[name], 'agents', 'extra-agent.md')), `${name} agent`);
    }
    assert.ok(fs.existsSync(path.join(dirs.work, 'projects', 'p1', 'a.jsonl')));
    assert.ok(fs.existsSync(path.join(dirs.extra, 'projects', 'p1', 'a.jsonl')));
    assert.ok(out.accounts.every((a) => a.errors.length === 0 && a.chats === 'linked'));
    const again = syncAllAccounts(accounts, { stateDir: path.join(root, 'state') });
    assert.ok(again.accounts.every((a) => a.chats === 'already linked' && a.setup.skills === 0));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an account with its own chats keeps them and still gets the setup', () => {
  const { root, dirs, accounts } = make(['hub', 'work']);
  try {
    put(path.join(dirs.hub, 'projects', 'p1', 'a.jsonl'));
    put(path.join(dirs.hub, 'skills', 's', 'SKILL.md'));
    put(path.join(dirs.work, 'projects', 'mine', 'b.jsonl'));
    const out = syncAllAccounts(accounts, { stateDir: path.join(root, 'state') });
    assert.equal(out.accounts[0].chats, 'kept separate');
    assert.match(out.accounts[0].errors[0], /existing chats were left untouched/i);
    assert.ok(fs.existsSync(path.join(dirs.work, 'projects', 'mine', 'b.jsonl')));
    assert.ok(fs.existsSync(path.join(dirs.work, 'skills', 's', 'SKILL.md')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('creates missing account folders, ignores duplicates and needs two accounts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-sync-'));
  try {
    const hub = path.join(root, 'hub');
    fs.mkdirSync(path.join(hub, 'plugins'), { recursive: true });
    const fresh = path.join(root, 'fresh');
    const out = syncAllAccounts([{ id: 'hub', configDir: hub }, { id: 'fresh', configDir: fresh }, { id: 'dup', configDir: hub }],
      { stateDir: path.join(root, 'state') });
    assert.equal(out.accounts.length, 1);
    assert.ok(fs.existsSync(path.join(fresh, 'projects')));
    assert.throws(() => syncAllAccounts([{ id: 'only', configDir: hub }]), /at least two/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

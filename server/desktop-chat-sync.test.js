import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listBackups } from './sync-support.js';
import { syncDesktopSessionRecords, syncDesktopSessionRecordsMany, repairEmptyDesktopSessionRecords, repairStaleDesktopSessionRecords, alignDesktopSessionBranches, findWindowsDesktopProfiles, reconcileWorkSessionRecords, sessionLeaves, checkedOutBranch } from './desktop-chat-sync.js';

// Keep sync state out of the real home folder.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sync-state-'));
process.env.DASHBOARD_SYNC_STATE_DIR = stateDir;
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

function twoProfiles(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const personal = path.join(root, 'personal');
  const work = path.join(root, 'work');
  const p = path.join(personal, 'claude-code-sessions', 'account', 'device');
  const w = path.join(work, 'claude-code-sessions', 'account', 'device');
  fs.mkdirSync(p, { recursive: true });
  fs.mkdirSync(w, { recursive: true });
  return { root, personal, work, p, w };
}

test('does not copy back a pointer deleted in one profile', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-deleted-');
  try {
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"title":"a"}');
    assert.equal(syncDesktopSessionRecords(personal, work).toWork, 1);
    fs.rmSync(path.join(w, 'local_abc.json'));
    assert.equal(syncDesktopSessionRecords(personal, work).toWork, 0);
    assert.equal(fs.existsSync(path.join(w, 'local_abc.json')), false);
    fs.writeFileSync(path.join(p, 'local_def.json'), '{"title":"new"}');
    assert.equal(syncDesktopSessionRecords(personal, work).toWork, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('respects minAgeMs and picks the active session folder among several', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-leaves-');
  try {
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{}');
    assert.equal(syncDesktopSessionRecords(personal, work, { minAgeMs: 60000 }).toWork, 0);
    const other = path.join(work, 'claude-code-sessions', 'other-account', 'device');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'local_old.json'), '{}');
    fs.utimesSync(path.join(other, 'local_old.json'), new Date(1000), new Date(1000));
    fs.writeFileSync(path.join(w, 'local_ee.json'), '{}');
    assert.equal(sessionLeaves(work), w);
    assert.throws(() => sessionLeaves(path.join(root, 'nope')), /No local Desktop session folder/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('repair never overwrites when lastActivityAt is missing', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-nan-');
  try {
    const name = 'local_2de2d777-183f-45a9-abd7-e5a5b7d5a67b.json';
    const id = name.slice(0, -5);
    fs.writeFileSync(path.join(p, name), JSON.stringify({ sessionId: id,
      cliSessionId: '26e615d1-a096-4913-ad43-707fa222f5eb', completedTurns: 4 }));
    fs.writeFileSync(path.join(w, name), JSON.stringify({ sessionId: id, lastActivityAt: 100 }));
    assert.equal(repairEmptyDesktopSessionRecords(personal, work), 0);
    assert.equal(repairStaleDesktopSessionRecords(personal, work), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reconcile keeps going after a bad file and reports the error', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-isolate-');
  try {
    fs.writeFileSync(path.join(p, 'local_aaa.json'), '{"completedTurns":1}');
    fs.mkdirSync(path.join(w, 'local_aaa.json')); // unreadable as a file (EISDIR)
    fs.writeFileSync(path.join(p, 'local_bbb.json'), '{"isArchived":true}');
    fs.writeFileSync(path.join(w, 'local_bbb.json'), '{"isArchived":false}');
    const errors = [];
    assert.equal(reconcileWorkSessionRecords(personal, work, { errors }), 1);
    assert.equal(errors.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(w, 'local_bbb.json'), 'utf8')).isArchived, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reads the checked-out branch without git, including linked worktrees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-head-'));
  try {
    const main = path.join(root, 'main');
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    fs.writeFileSync(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(main, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/feature/x\n');
    const linked = path.join(root, 'linked', 'sub');
    fs.mkdirSync(linked, { recursive: true });
    fs.writeFileSync(path.join(root, 'linked', '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
    assert.equal(checkedOutBranch(main), 'main');
    assert.equal(checkedOutBranch(linked), 'feature/x');
    fs.writeFileSync(path.join(main, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    assert.equal(checkedOutBranch(main), null);
    assert.equal(checkedOutBranch(path.join(root, 'missing')), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reports a clear error when the Packages folder is missing', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-no-packages-'));
  try {
    assert.throws(() => findWindowsDesktopProfiles(local), /packages folder not found/);
  } finally { fs.rmSync(local, { recursive: true, force: true }); }
});

test('copies nested parent and child records across three profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-three-profiles-'));
  try {
    const profiles = Object.fromEntries(['personal', 'work', 'third'].map((name) => {
      const folder = path.join(root, name);
      fs.mkdirSync(path.join(folder, 'claude-code-sessions', name, 'device'), { recursive: true });
      return [name, folder];
    }));
    const leaf = (name) => path.join(profiles[name], 'claude-code-sessions', name, 'device');
    const parent = 'local_11111111-1111-4111-8111-111111111111';
    const child = 'local_22222222-2222-4222-8222-222222222222';
    fs.writeFileSync(path.join(leaf('personal'), `${parent}.json`), JSON.stringify({
      sessionId: parent, title: 'Parent', completedTurns: 2,
    }));
    fs.writeFileSync(path.join(leaf('third'), `${child}.json`), JSON.stringify({
      sessionId: child, forkedFromSessionId: parent, title: 'Child', completedTurns: 1,
    }));
    const result = syncDesktopSessionRecordsMany(profiles);
    assert.equal(result.copied.work, 2);
    assert.equal(result.copied.personal, 1);
    assert.equal(result.copied.third, 1);
    for (const name of Object.keys(profiles)) {
      const childRecord = JSON.parse(fs.readFileSync(path.join(leaf(name), `${child}.json`)));
      assert.equal(childRecord.forkedFromSessionId, parent);
      assert.ok(fs.existsSync(path.join(leaf(name), `${parent}.json`)));
    }
    assert.deepEqual(syncDesktopSessionRecordsMany(profiles).copied,
      { personal: 0, work: 0, third: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('repairs newer full transcript pointer into closed Personal profile without losing backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-stale-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    const p = path.join(personal, 'claude-code-sessions', 'account', 'device');
    const w = path.join(work, 'claude-code-sessions', 'account', 'device');
    fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(w, { recursive: true });
    const name = 'local_bbaebc38-b69e-41f0-9a7a-68a45133298d.json';
    const sessionId = name.slice(0, -5);
    const older = { sessionId, cliSessionId: 'f06a3779-e1f5-4b3d-bb34-7dd745e0e247',
      title: 'Bot HZ.exe security testing', completedTurns: 0, lastActivityAt: 100 };
    const newer = { sessionId, cliSessionId: '5603d0eb-a1d3-4483-8108-a10b1afd7fbf',
      title: older.title, completedTurns: 85, lastActivityAt: 200 };
    fs.writeFileSync(path.join(p, name), JSON.stringify(older));
    fs.writeFileSync(path.join(w, name), JSON.stringify(newer));
    assert.equal(repairStaleDesktopSessionRecords(personal, work, { targetProfile: 'personal' }), 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p, name), 'utf8')), newer);
    assert.equal(repairStaleDesktopSessionRecords(personal, work, { targetProfile: 'personal' }), 0);
    assert.equal(listBackups(path.join(p, name), 'stale').length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('closed Work profile follows Personal archive state and newer turns', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-work-reconcile-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    const p = path.join(personal, 'claude-code-sessions', 'account', 'device');
    const w = path.join(work, 'claude-code-sessions', 'account', 'device');
    fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(w, { recursive: true });
    const name = 'local_123abc.json';
    fs.writeFileSync(path.join(p, name), JSON.stringify({ title: 'Same chat', isArchived: false,
      completedTurns: 5, lastActivityAt: 500, lastAssistantUuid: 'latest' }));
    fs.writeFileSync(path.join(w, name), JSON.stringify({ title: 'Same chat', isArchived: true,
      completedTurns: 3, lastActivityAt: 300, workOnly: 'kept' }));
    assert.equal(reconcileWorkSessionRecords(personal, work), 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w, name), 'utf8')),
      { title: 'Same chat', isArchived: false, completedTurns: 5, lastActivityAt: 500,
        workOnly: 'kept', lastAssistantUuid: 'latest' });
    assert.equal(reconcileWorkSessionRecords(personal, work), 0);
    assert.equal(listBackups(path.join(w, name), 'reconcile').length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('discovers migrated Personal profile and existing Work profile', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-profile-paths-'));
  try {
    const root = path.join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache');
    const personal = path.join(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
    const work = path.join(root, 'Local', 'ClaudeProfiles', 'Work');
    fs.mkdirSync(path.join(root, 'Roaming', 'Claude', 'claude-code-sessions'), { recursive: true });
    fs.mkdirSync(path.join(personal, 'claude-code-sessions'), { recursive: true });
    fs.mkdirSync(path.join(work, 'claude-code-sessions'), { recursive: true });
    assert.deepEqual(findWindowsDesktopProfiles(local), { personal, work });
  } finally { fs.rmSync(local, { recursive: true, force: true }); }
});

test('discovers additional isolated Desktop profiles', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-extra-profile-'));
  try {
    const root = path.join(local, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache');
    const personal = path.join(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
    const work = path.join(root, 'Local', 'ClaudeProfiles', 'Work');
    const third = path.join(local, 'ClaudeProfiles', 'Third');
    for (const profile of [personal, work, third]) {
      fs.mkdirSync(path.join(profile, 'claude-code-sessions'), { recursive: true });
    }
    fs.mkdirSync(path.join(third, 'claude-code-sessions', 'third-account', 'device'), { recursive: true });
    assert.deepEqual(findWindowsDesktopProfiles(local), { personal, work, third });
  } finally { fs.rmSync(local, { recursive: true, force: true }); }
});

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
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 1, toPersonal: 1, conflicts: 0, deleted: 0 });
    assert.equal(fs.readFileSync(path.join(w, 'local_abc.json'), 'utf8'), '{"title":"personal"}');
    assert.equal(fs.readFileSync(path.join(p, 'local_def.json'), 'utf8'), '{"title":"work"}');
    fs.writeFileSync(path.join(w, 'local_123abc.json'), '{"title":"new work session"}');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 1, conflicts: 0, deleted: 0 });
    assert.equal(fs.readFileSync(path.join(p, 'local_123abc.json'), 'utf8'), '{"title":"new work session"}');
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"title":"changed"}');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 0, conflicts: 1, deleted: 0 });
    assert.equal(fs.readFileSync(path.join(w, 'local_abc.json'), 'utf8'), '{"title":"personal"}');
    fs.writeFileSync(path.join(p, 'local_bad.json'), '{"title":');
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 0, conflicts: 1, deleted: 0 });
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
    assert.deepEqual(syncDesktopSessionRecords(personal, work), { toWork: 0, toPersonal: 0, conflicts: 0, deleted: 0 });
    assert.deepEqual(fs.readdirSync(p), ['local_abc-123.json']);
    assert.deepEqual(fs.readdirSync(w), ['local_original.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('repairs only clearly empty matching pointer after Desktop exits and keeps backup', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-repair-'));
  try {
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    const p = path.join(personal, 'claude-code-sessions', 'personal-account', 'device');
    const w = path.join(work, 'claude-code-sessions', 'work-account', 'device');
    fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(w, { recursive: true });
    const name = 'local_2de2d777-183f-45a9-abd7-e5a5b7d5a67b.json';
    const id = 'local_2de2d777-183f-45a9-abd7-e5a5b7d5a67b';
    const full = { sessionId: id, cliSessionId: '26e615d1-a096-4913-ad43-707fa222f5eb',
      completedTurns: 380, lastActivityAt: 200, title: 'Full chat' };
    const empty = { sessionId: id, lastActivityAt: 100, title: 'Full chat' };
    fs.writeFileSync(path.join(p, name), JSON.stringify(full));
    fs.writeFileSync(path.join(w, name), JSON.stringify(empty));
    assert.equal(repairEmptyDesktopSessionRecords(personal, work, { targetProfile: 'personal' }), 0);
    assert.equal(repairEmptyDesktopSessionRecords(personal, work, { targetProfile: 'work' }), 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w, name), 'utf8')), full);
    assert.equal(listBackups(path.join(w, name)).length, 1);
    assert.equal(repairEmptyDesktopSessionRecords(personal, work), 0);
    fs.writeFileSync(path.join(w, name), JSON.stringify({ ...empty, completedTurns: 1 }));
    assert.equal(repairEmptyDesktopSessionRecords(personal, work), 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('repair uses branch currently checked out in copied worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-branch-'));
  try {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-b', 'current-branch', repo], { stdio: 'ignore' });
    const personal = path.join(root, 'personal');
    const work = path.join(root, 'work');
    const p = path.join(personal, 'claude-code-sessions', 'personal-account', 'device');
    const w = path.join(work, 'claude-code-sessions', 'work-account', 'device');
    fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(w, { recursive: true });
    const name = 'local_2de2d777-183f-45a9-abd7-e5a5b7d5a67b.json';
    const id = 'local_2de2d777-183f-45a9-abd7-e5a5b7d5a67b';
    fs.writeFileSync(path.join(p, name), JSON.stringify({ sessionId: id,
      cliSessionId: '26e615d1-a096-4913-ad43-707fa222f5eb', completedTurns: 2,
      lastActivityAt: 200, worktreePath: repo, branch: 'stale-branch' }));
    fs.writeFileSync(path.join(w, name), JSON.stringify({ sessionId: id, lastActivityAt: 100 }));
    assert.equal(repairEmptyDesktopSessionRecords(personal, work), 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(w, name), 'utf8')).branch, 'current-branch');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('closed profile updates stale branch with backup, then leaves it stable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-desktop-align-'));
  try {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    execFileSync('git', ['init', '-b', 'current-branch', repo], { stdio: 'ignore' });
    const profile = path.join(root, 'work');
    const leaf = path.join(profile, 'claude-code-sessions', 'account', 'device');
    fs.mkdirSync(leaf, { recursive: true });
    const file = path.join(leaf, 'local_2de2d777-183f-45a9-abd7-e5a5b7d5a67b.json');
    fs.writeFileSync(file, JSON.stringify({ cliSessionId: '26e615d1-a096-4913-ad43-707fa222f5eb',
      completedTurns: 2, worktreePath: repo, branch: 'stale-branch' }));
    assert.equal(alignDesktopSessionBranches(profile), 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).branch, 'current-branch');
    assert.equal(alignDesktopSessionBranches(profile), 0);
    assert.equal(listBackups(file, 'branch').length, 1);
    assert.equal(fs.readdirSync(leaf).filter((name) => name.includes('.backup-')).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const trashed = () => {
  try { return fs.readdirSync(path.join(stateDir, 'trash', 'chat-pointers')); } catch { return []; }
};

test('propagates a deletion to the other profile through the trash, once proven safe', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-delprop-');
  const before = trashed().length;
  try {
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"title":"a"}');
    fs.writeFileSync(path.join(p, 'local_dd.json'), '{"title":"k"}');
    syncDesktopSessionRecords(personal, work); // copies both
    syncDesktopSessionRecords(personal, work); // records the baseline
    fs.rmSync(path.join(w, 'local_abc.json'));
    const result = syncDesktopSessionRecords(personal, work);
    assert.equal(result.deleted, 1);
    assert.equal(fs.existsSync(path.join(p, 'local_abc.json')), false);
    assert.equal(fs.existsSync(path.join(w, 'local_abc.json')), false);
    assert.equal(fs.existsSync(path.join(p, 'local_dd.json')), true);
    assert.equal(trashed().length, before + 1);
    assert.equal(syncDesktopSessionRecords(personal, work).deleted, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('keeps a chat that changed after the other profile deleted it', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-delchanged-');
  try {
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"title":"a"}');
    syncDesktopSessionRecords(personal, work);
    syncDesktopSessionRecords(personal, work);
    fs.rmSync(path.join(w, 'local_abc.json'));
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"title":"a","completedTurns":3}');
    assert.equal(syncDesktopSessionRecords(personal, work).deleted, 0);
    assert.equal(fs.existsSync(path.join(p, 'local_abc.json')), true);
    assert.equal(fs.existsSync(path.join(w, 'local_abc.json')), false); // and not copied back
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('never deletes without a baseline, when disabled, when too new, or on mass disappearance', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-delguard-');
  try {
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) fs.writeFileSync(path.join(p, `local_${id}.json`), `{"t":"${id}"}`);
    syncDesktopSessionRecords(personal, work);
    // Work is wiped right after the first run: no baseline from a previous tick yet for hashes of a stable layout.
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) fs.rmSync(path.join(w, `local_${id}.json`));
    assert.equal(syncDesktopSessionRecords(personal, work, { propagateDeletions: false }).deleted, 0);
    assert.equal(syncDesktopSessionRecords(personal, work, { minAgeMs: 60000 }).deleted, 0);
    assert.equal(syncDesktopSessionRecords(personal, work).deleted, 0); // 5 of 5 missing: mass guard
    assert.equal(fs.readdirSync(p).filter((name) => name.startsWith('local_')).length, 5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a changed session folder layout suspends deletion for that run', () => {
  const { root, personal, work, p, w } = twoProfiles('claude-desktop-dellayout-');
  try {
    fs.writeFileSync(path.join(p, 'local_abc.json'), '{"t":1}');
    syncDesktopSessionRecords(personal, work);
    syncDesktopSessionRecords(personal, work);
    fs.rmSync(path.join(w, 'local_abc.json'));
    // A newer account folder appears in Work, so the "active" leaf is now a different, empty one.
    const other = path.join(work, 'claude-code-sessions', 'second-account', 'device');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'local_ee.json'), '{}');
    assert.equal(syncDesktopSessionRecords(personal, work).deleted, 0);
    assert.equal(fs.existsSync(path.join(p, 'local_abc.json')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('uses every active session folder of the signed-in accounts and reports no multi-folder error', () => {
  const { root, personal, work, p } = twoProfiles('claude-desktop-multileaf-');
  try {
    // Work is signed in with two accounts; each has a session folder.
    const second = path.join(work, 'claude-code-sessions', 'acct2', 'device');
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(work, 'claude_desktop_config.json'), JSON.stringify({ preferences: { epitaxyPrefs: {
      'dframe-code-sections': { 'account/org': { sections: [] }, 'acct2/org': { sections: [] } } } } }));
    fs.writeFileSync(path.join(second, 'local_a2.json'), '{"title":"two"}');
    fs.writeFileSync(path.join(p, 'local_a1.json'), '{"title":"one"}');
    const result = syncDesktopSessionRecords(personal, work);
    assert.equal(result.toPersonal, 1); // the chat that lives in Work's second account folder
    assert.equal(result.toWork, 1);
    assert.equal(fs.existsSync(path.join(p, 'local_a2.json')), true);
    assert.equal(syncDesktopSessionRecords(personal, work).toWork, 0);
    // An account that is no longer signed in is not synced.
    const stale = path.join(work, 'claude-code-sessions', 'gone', 'device');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, 'local_f9.json'), '{}');
    assert.equal(syncDesktopSessionRecords(personal, work).toPersonal, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('repairs and branch alignment reach pointers in every active session folder', () => {
  const { root, work } = twoProfiles('claude-desktop-multileaf-align-');
  try {
    const second = path.join(work, 'claude-code-sessions', 'acct2', 'device');
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(work, 'claude_desktop_config.json'), JSON.stringify({ preferences: { epitaxyPrefs: {
      'dframe-code-sections': { 'account/org': { sections: [] }, 'acct2/org': { sections: [] } } } } }));
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/current\n');
    const file = path.join(second, 'local_aa.json');
    fs.writeFileSync(file, JSON.stringify({ sessionId: 'local_aa', cliSessionId: 'cli', completedTurns: 2, worktreePath: repo, branch: 'old' }));
    assert.equal(alignDesktopSessionBranches(work), 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).branch, 'current');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('backups go to the dedicated folder and only the newest are kept', () => {
  const { root, p, personal } = twoProfiles('claude-desktop-backups-');
  try {
    const file = path.join(p, 'local_bb.json');
    for (let i = 0; i < 8; i++) {
      fs.writeFileSync(file, JSON.stringify({ sessionId: 'local_bb', cliSessionId: 'c', completedTurns: 1, worktreePath: path.join(root, 'repo'), branch: `b${i}` }));
      const repo = path.join(root, 'repo');
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.git', 'HEAD'), `ref: refs/heads/new${i}\n`);
      assert.equal(alignDesktopSessionBranches(personal), 1);
    }
    assert.equal(listBackups(file, 'branch').length, 5);
    assert.ok(listBackups(file, 'branch')[0].startsWith(path.join(stateDir, 'backups')));
    assert.equal(fs.readdirSync(p).some((name) => name.includes('.backup-')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

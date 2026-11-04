import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';
import { listBackups } from './sync-support.js';
import { syncMergedDesktopLabels, syncMergedDesktopLabelsMany, desktopLabelSnapshot, desktopLabelSyncStatus,
  encodeLocalStorageValue, decodeLocalStorageValue } from './desktop-label-sync.js';

// Keep sync state out of the real home folder.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-state-'));
process.env.DASHBOARD_SYNC_STATE_DIR = stateDir;
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
const desktopLabelFingerprint = (profile) => JSON.stringify(desktopLabelSnapshot(profile));

test('merges independent Desktop categories into both closed profiles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-merge-'));
  try {
    const prefix = Buffer.from('_https://claude.ai\0', 'latin1');
    const setup = async (name, groups, assignments) => {
      const profile = path.join(root, name);
      const scope = `${name}-scope`;
      const leaf = path.join(profile, 'claude-code-sessions', scope, 'device');
      fs.mkdirSync(leaf, { recursive: true });
      for (const id of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(leaf, `local_${id}.json`),
        JSON.stringify({ sessionId: `local_${id}`, title: id }));
      const state = { groups, assignments, order: {} };
      const sections = [{ id: 'pinned', kind: 'pinned', order: 0 },
        ...groups.map((group, index) => ({ id: group.id, kind: 'manual', name: group.name,
          order: index + 1, members: [] })),
        { id: 'sessions', kind: 'sessions', order: groups.length + 1 }];
      fs.writeFileSync(path.join(profile, 'claude_desktop_config.json'), JSON.stringify({ preferences: {
        epitaxyPrefs: { 'dframe-group-scopes': { [scope]: state },
          'dframe-code-sections': { [scope]: { sections } } } } }));
      const db = new ClassicLevel(path.join(profile, 'Local Storage', 'leveldb'),
        { keyEncoding: 'buffer', valueEncoding: 'buffer' });
      await db.open();
      const put = (key, value) => db.put(Buffer.concat([prefix, Buffer.from([1, ...Buffer.from(key)])]),
        Buffer.concat([Buffer.from([1]), Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]));
      await put('ccd-sync-owner', scope);
      await put('dframe-store', { version: 1, state: { customGroupsByScope: { [scope]: state },
        codeSidebarByScope: { [scope]: { sections } } } });
      await put('LSS-persisted.dframe-group-scopes', { value: { [scope]: state }, timestamp: 0 });
      await put('LSS-persisted.dframe-code-sections', { value: { [scope]: { sections } }, timestamp: 0 });
      await db.close();
      return profile;
    };
    const personal = await setup('personal', [{ id: 'trip-p', name: 'viagens' }],
      { 'code:local_a': 'trip-p' });
    const work = await setup('work', [{ id: 'trip-w', name: 'viagens' }, { id: 'gaming', name: 'gaming' }],
      { 'code:local_b': 'trip-w', 'code:local_c': 'gaming' });
    await syncMergedDesktopLabels(personal, work, { targetProfile: 'work' });
    const personalBefore = JSON.parse(fs.readFileSync(path.join(personal, 'claude_desktop_config.json')));
    assert.deepEqual(personalBefore.preferences.epitaxyPrefs['dframe-group-scopes']['personal-scope'].groups
      .map((group) => group.name), ['viagens']);
    await syncMergedDesktopLabels(personal, work);
    for (const profile of [personal, work]) {
      const config = JSON.parse(fs.readFileSync(path.join(profile, 'claude_desktop_config.json')));
      const scope = path.basename(profile) + '-scope';
      const state = config.preferences.epitaxyPrefs['dframe-group-scopes'][scope];
      assert.deepEqual(state.groups.map((group) => group.name), ['viagens', 'gaming']);
      assert.deepEqual(state.assignments, { 'code:local_a': 'trip-p',
        'code:local_b': 'trip-p', 'code:local_c': 'gaming' });
    }
    assert.equal(desktopLabelFingerprint(personal), desktopLabelFingerprint(work));
    const third = await setup('third', [{ id: 'third-project', name: 'Third project' }],
      { 'code:local_c': 'third-project' });
    const conflicted = await syncMergedDesktopLabelsMany({ personal, work, third });
    assert.deepEqual(conflicted.conflicts.map((conflict) => conflict.chat), ['code:local_c']);
    const thirdConfigPath = path.join(third, 'claude_desktop_config.json');
    const thirdConfig = JSON.parse(fs.readFileSync(thirdConfigPath, 'utf8'));
    const thirdState = thirdConfig.preferences.epitaxyPrefs['dframe-group-scopes']['third-scope'];
    thirdState.assignments = { 'code:local_d': 'third-project' };
    fs.writeFileSync(thirdConfigPath, JSON.stringify(thirdConfig));
    const thirdTitlePath = path.join(third, 'claude-code-sessions', 'third-scope', 'device', 'local_a.json');
    fs.writeFileSync(thirdTitlePath, JSON.stringify({ sessionId: 'local_a', title: 'Shared title' }));
    fs.utimesSync(thirdTitlePath, new Date('2030-01-01'), new Date('2030-01-01'));
    await syncMergedDesktopLabelsMany({ personal, work, third });
    assert.equal(desktopLabelFingerprint(personal), desktopLabelFingerprint(third));
    assert.equal(desktopLabelFingerprint(work), desktopLabelFingerprint(third));
    for (const profile of [personal, work, third]) {
      const titlePath = path.join(profile, 'claude-code-sessions', `${path.basename(profile)}-scope`, 'device', 'local_a.json');
      assert.equal(JSON.parse(fs.readFileSync(titlePath, 'utf8')).title, 'Shared title');
    }
    const workTitlePath = path.join(work, 'claude-code-sessions', 'work-scope', 'device', 'local_a.json');
    fs.writeFileSync(workTitlePath, JSON.stringify({ sessionId: 'local_a', title: 'Renamed in Work' }));
    fs.utimesSync(workTitlePath, new Date('2031-01-01'), new Date('2031-01-01'));
    await syncMergedDesktopLabelsMany({ personal, work, third }, { targetIds: ['third'] });
    assert.equal(JSON.parse(fs.readFileSync(thirdTitlePath, 'utf8')).title, 'Renamed in Work');
    const personalTitlePath = path.join(personal, 'claude-code-sessions', 'personal-scope', 'device', 'local_a.json');
    assert.equal(JSON.parse(fs.readFileSync(personalTitlePath, 'utf8')).title, 'Shared title');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('copies sidebar groups and chat titles into corresponding profile scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-sync-'));
  try {
    const [personal, work] = ['personal', 'work'].map((name) => path.join(root, name));
    const setup = (profile, scope, filename, title, groups) => {
      const leaf = path.join(profile, 'claude-code-sessions', scope, 'device');
      fs.mkdirSync(leaf, { recursive: true });
      fs.writeFileSync(path.join(leaf, filename), JSON.stringify({
        sessionId: 'shared-session',
        cliSessionId: scope === 'personal-scope' ? 'personal-cli-session' : undefined,
        title,
      }));
      const group = { id: 'cg-1', name: 'Project' };
      const config = { preferences: { epitaxyPrefs: {
        'dframe-group-scopes': groups ? { [scope]: { groups: [group], assignments: { [`code:${filename.slice(0, -5)}`]: group.id }, order: { [group.id]: [`code:${filename.slice(0, -5)}`] } } } : {},
        'dframe-code-sections': { [scope]: { sections: groups
          ? [{ id: 'pinned', kind: 'pinned', order: 0 }, { id: group.id, kind: 'manual', name: group.name, order: 1, members: [] }, { id: 'sessions', kind: 'sessions', order: 2 }]
          : [{ id: 'pinned', kind: 'pinned', order: 0 }, { id: 'sessions', kind: 'sessions', order: 1 }] } },
      } } };
      fs.writeFileSync(path.join(profile, 'claude_desktop_config.json'), JSON.stringify(config));
    };
    setup(personal, 'personal-scope', 'local_111.json', 'Same title', true);
    setup(work, 'work-scope', 'local_222.json', 'Old title', false);
    const db = new ClassicLevel(path.join(work, 'Local Storage', 'leveldb'),
      { keyEncoding: 'buffer', valueEncoding: 'buffer' });
    await db.open();
    const prefix = Buffer.from('_https://claude.ai\0', 'latin1');
    const put = (key, value) => db.put(Buffer.concat([prefix, Buffer.concat([Buffer.from([1]), Buffer.from(key)])]),
      Buffer.concat([Buffer.from([1]), Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]));
    await put('ccd-sync-owner', 'work-scope');
    await put('dframe-store', { version: 1, state: { customGroupsByScope: { 'work-scope': { groups: [], assignments: {}, order: {} } }, codeSidebarByScope: { 'work-scope': { sections: [{ id: 'sessions', kind: 'sessions' }] } } } });
    await put('LSS-persisted.dframe-group-scopes', { value: {}, tabId: '', timestamp: 0 });
    await put('LSS-persisted.dframe-code-sections', { value: { 'work-scope': { sections: [] } }, tabId: '', timestamp: 0 });
    await db.close();
    const personalRecord = path.join(personal, 'claude-code-sessions', 'personal-scope', 'device', 'local_111.json');
    fs.utimesSync(personalRecord, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
    const first = await syncMergedDesktopLabels(personal, work, { targetProfile: 'work' });
    assert.deepEqual([first.titles, first.groups, first.assignments, first.updated], [1, 1, 1, 1]);
    const config = JSON.parse(fs.readFileSync(path.join(work, 'claude_desktop_config.json')));
    const prefs = config.preferences.epitaxyPrefs;
    assert.equal(prefs['dframe-group-scopes']['work-scope'].groups[0].name, 'Project');
    assert.equal(prefs['dframe-group-scopes']['work-scope'].assignments['code:local_222'], 'cg-1');
    assert.deepEqual(prefs['dframe-group-scopes']['work-scope'].order['cg-1'], ['code:local_222']);
    assert.equal(prefs['dframe-code-sections']['work-scope'].sections[1].name, 'Project');
    assert.equal(JSON.parse(fs.readFileSync(path.join(work, 'claude-code-sessions', 'work-scope', 'device', 'local_222.json'))).title, 'Same title');
    const saved = new ClassicLevel(path.join(work, 'Local Storage', 'leveldb'),
      { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    await saved.open();
    const get = async (key) => (await saved.get(Buffer.concat([prefix, Buffer.concat([Buffer.from([1]), Buffer.from(key)])]))).subarray(1).toString();
    const store = JSON.parse(await get('dframe-store'));
    assert.equal(store.state.customGroupsByScope['work-scope'].groups[0].name, 'Project');
    assert.equal(store.state.codeSidebarByScope['work-scope'].sections[1].name, 'Project');
    assert.equal(await get('ccd-sync-pending:ccd/dframe-store'), 'work-scope');
    await saved.close();
    assert.equal(desktopLabelFingerprint(personal), desktopLabelFingerprint(work));
    const second = await syncMergedDesktopLabels(personal, work, { targetProfile: 'work' });
    assert.deepEqual([second.titles, second.updated], [0, 0]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

async function makeProfile(root, name, { owner = `${name}-scope`, chats = ['a'], groups = [], assignments = {}, withDb = true, sectionsEntry } = {}) {
  const prefix = Buffer.from('_https://claude.ai\0', 'latin1');
  const profile = path.join(root, name);
  const scope = `${name}-scope`;
  const leaf = path.join(profile, 'claude-code-sessions', scope, 'device');
  fs.mkdirSync(leaf, { recursive: true });
  for (const id of chats) fs.writeFileSync(path.join(leaf, `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, title: id }));
  const state = { groups, assignments, order: {} };
  const sections = [{ id: 'sessions', kind: 'sessions', order: 0 }];
  fs.writeFileSync(path.join(profile, 'claude_desktop_config.json'), JSON.stringify({ preferences: { epitaxyPrefs: {
    'dframe-group-scopes': { [scope]: state },
    'dframe-code-sections': { [scope]: sectionsEntry ?? { sections } } } } }));
  if (withDb) {
    const db = new ClassicLevel(path.join(profile, 'Local Storage', 'leveldb'), { keyEncoding: 'buffer', valueEncoding: 'buffer' });
    await db.open();
    const put = (key, value) => db.put(Buffer.concat([prefix, Buffer.from([1, ...Buffer.from(key)])]),
      Buffer.concat([Buffer.from([1]), Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))]));
    await put('ccd-sync-owner', owner);
    await put('dframe-store', { version: 1, state: { customGroupsByScope: { [scope]: state }, codeSidebarByScope: { [scope]: { sections } } } });
    await put('LSS-persisted.dframe-group-scopes', { value: { [scope]: state }, timestamp: 0 });
    await put('LSS-persisted.dframe-code-sections', { value: { [scope]: { sections } }, timestamp: 0 });
    await db.close();
  }
  return profile;
}

test('encodes non-Latin-1 text and emoji round trip', () => {
  for (const text of ['plain', 'café', '你好', 'rocket 🚀']) {
    assert.equal(decodeLocalStorageValue(encodeLocalStorageValue(text)), text);
  }
});

test('label sync reports availability of the optional classic-level package', async () => {
  assert.deepEqual(await desktopLabelSyncStatus(), { available: true });
});

test('failed validation leaves no LevelDB backup and no config change', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-validate-'));
  try {
    const personal = await makeProfile(root, 'personal', { groups: [{ id: 'g', name: 'G' }], assignments: { 'code:local_a': 'g' } });
    const work = await makeProfile(root, 'work', { owner: 'someone-else' });
    const configPath = path.join(work, 'claude_desktop_config.json');
    const before = fs.readFileSync(configPath, 'utf8');
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(syncMergedDesktopLabels(personal, work, { targetProfile: 'work', stateDir }), /does not match its account scope/);
    }
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.join(work, 'Local Storage')).filter((name) => name.includes('backup')), []);
    assert.deepEqual(fs.readdirSync(work).filter((name) => name.includes('backup')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('profiles without a sections list do not crash the snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-nosections-'));
  try {
    const profile = await makeProfile(root, 'personal', { withDb: false, sectionsEntry: {} });
    assert.deepEqual(desktopLabelSnapshot(profile).manuals, []);
    const bad = await makeProfile(root, 'work', { withDb: false, sectionsEntry: { sections: 'nope' } });
    assert.throws(() => desktopLabelSnapshot(bad), /schema changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a rename survives a later newer file on another profile', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-title-'));
  try {
    const personal = await makeProfile(root, 'personal');
    const work = await makeProfile(root, 'work');
    const file = (profile) => path.join(profile, 'claude-code-sessions', `${path.basename(profile)}-scope`, 'device', 'local_a.json');
    const read = (profile) => JSON.parse(fs.readFileSync(file(profile), 'utf8')).title;
    await syncMergedDesktopLabels(personal, work, { stateDir });
    const workRecord = JSON.parse(fs.readFileSync(file(work), 'utf8'));
    fs.writeFileSync(file(work), JSON.stringify({ ...workRecord, title: 'Renamed' }));
    fs.utimesSync(file(work), new Date('2030-01-01'), new Date('2030-01-01'));
    fs.utimesSync(file(personal), new Date('2031-01-01'), new Date('2031-01-01')); // personal touched later, title untouched
    await syncMergedDesktopLabels(personal, work, { stateDir });
    assert.equal(read(personal), 'Renamed');
    assert.equal(read(work), 'Renamed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('profile with several sidebar scopes syncs the signed-in one and leaves the others alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-multiscope-'));
  try {
    const group = { id: 'g1', name: 'Group' };
    const personal = await makeProfile(root, 'personal', { groups: [group], assignments: { 'code:local_a': 'g1' } });
    const work = await makeProfile(root, 'work');
    // Second, no longer signed-in account in the Work profile.
    const configPath = path.join(work, 'claude_desktop_config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.preferences.epitaxyPrefs['dframe-group-scopes']['old/org'] = { groups: [], assignments: {}, order: {} };
    config.preferences.epitaxyPrefs['dframe-code-sections']['old/org'] = { sections: [{ id: 'sessions', kind: 'sessions', order: 0 }] };
    fs.writeFileSync(configPath, JSON.stringify(config));
    const oldLeaf = path.join(work, 'claude-code-sessions', 'old', 'device');
    fs.mkdirSync(oldLeaf, { recursive: true });
    fs.writeFileSync(path.join(oldLeaf, 'local_z.json'), JSON.stringify({ sessionId: 'local_z', title: 'z' }));
    assert.ok(desktopLabelSnapshot(work));
    const result = await syncMergedDesktopLabels(personal, work, { targetProfile: 'work', stateDir });
    assert.deepEqual(result.skippedScopes, ['work#old/org']);
    assert.equal(result.updated, 1);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')).preferences.epitaxyPrefs;
    assert.equal(saved['dframe-group-scopes']['work-scope'].groups[0].name, 'Group');
    assert.deepEqual(saved['dframe-group-scopes']['old/org'].groups, []);
    // Backups go to the dedicated folder, not next to the config.
    assert.equal(fs.readdirSync(work).some((name) => name.includes('.backup-')), false);
    assert.ok(listBackups(configPath).length >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

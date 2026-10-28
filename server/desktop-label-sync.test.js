import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClassicLevel } from 'classic-level';
import { syncDesktopLabels, syncMergedDesktopLabels, desktopLabelFingerprint } from './desktop-label-sync.js';

test('merges independent Desktop categories into both closed profiles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-label-merge-'));
  try {
    const prefix = Buffer.from('_https://claude.ai\0', 'latin1');
    const setup = async (name, groups, assignments) => {
      const profile = path.join(root, name);
      const scope = `${name}-scope`;
      const leaf = path.join(profile, 'claude-code-sessions', scope, 'device');
      fs.mkdirSync(leaf, { recursive: true });
      for (const id of ['a', 'b', 'c']) fs.writeFileSync(path.join(leaf, `local_${id}.json`),
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
    assert.deepEqual(await syncDesktopLabels(personal, work), { titles: 1, groups: 1, assignments: 1 });
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
    assert.deepEqual(await syncDesktopLabels(personal, work), { titles: 0, groups: 0, assignments: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

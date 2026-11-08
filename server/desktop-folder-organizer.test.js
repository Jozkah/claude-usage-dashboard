import test from 'node:test';
import assert from 'node:assert/strict';
import { organizeDesktopFolders } from './desktop-folder-organizer.js';

test('organizes scratch and duplicate project folders without changing existing assignments', () => {
  const snapshot = {
    groups: [{ id: 'project', name: 'Project', mode: 'code' }],
    assignments: [['code:one', 'project']], order: [],
    manuals: [{ id: 'project', kind: 'manual', name: 'Project', members: [] }],
  };
  const values = [
    { sessionId: 'one', cwd: 'C:\\Coding\\Project' },
    { sessionId: 'two', cwd: 'C:\\Coding\\Project' },
    { sessionId: 'three', cwd: 'C:\\Scratch\\scratch-2026-10-26-15d0fa' },
    { sessionId: 'four', cwd: 'C:\\Coding\\Other' },
  ];
  const participants = [{ records: new Map(values.map((value, index) => [index, { value }])) }];
  const { snapshot: organized, inferred, general } = organizeDesktopFolders(snapshot, participants);
  assert.equal(inferred, 1);
  assert.equal(general, 1);
  assert.equal(organized.groups.find((group) => group.name === 'General')?.mode, 'code');
  assert.equal(new Map(organized.assignments).get('code:two'), 'project');
  assert.equal(new Map(organized.assignments).get('code:three'), organized.groups.at(-1).id);
  assert.equal(new Map(organized.assignments).has('code:four'), false);
  assert.deepEqual(snapshot.assignments, [['code:one', 'project']]);
  assert.deepEqual(organizeDesktopFolders(organized, participants).snapshot, organized);
});

test('leaves ambiguous project folders alone', () => {
  const snapshot = { groups: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }],
    assignments: [['code:a', 'one'], ['code:b', 'two']], order: [], manuals: [] };
  const values = ['a', 'b', 'c'].map((sessionId) => ({ value: {
    sessionId, cwd: 'C:\\Coding\\Shared',
  } }));
  const { snapshot: organized } = organizeDesktopFolders(snapshot,
    [{ records: new Map(values.map((record, index) => [index, record])) }]);
  assert.equal(new Map(organized.assignments).has('code:c'), false);
  assert.equal(organized.groups.length, 2);
});

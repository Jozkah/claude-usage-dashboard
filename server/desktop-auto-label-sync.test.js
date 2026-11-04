import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDesktopLabelSnapshots, mergeDesktopLabelSnapshotsThreeWay } from './desktop-auto-label-sync.js';

test('merges independently added groups and assignments without duplicating same-name groups', () => {
  const personal = { groups: [{ id: 'p-trip', name: 'viagens' }],
    assignments: [['code:a', 'p-trip']], order: [['p-trip', ['code:a']]],
    manuals: [{ id: 'p-trip', name: 'viagens', kind: 'manual', members: [] }] };
  const work = { groups: [{ id: 'w-trip', name: 'viagens' }, { id: 'gaming', name: 'gaming' }],
    assignments: [['code:b', 'w-trip'], ['code:c', 'gaming']],
    order: [['w-trip', ['code:b']], ['gaming', ['code:c']]],
    manuals: [{ id: 'w-trip', name: 'viagens', kind: 'manual', members: [] },
      { id: 'gaming', name: 'gaming', kind: 'manual', members: [] }] };
  const merged = mergeDesktopLabelSnapshots(personal, work);
  assert.deepEqual(merged.groups, [{ id: 'p-trip', name: 'viagens' }, { id: 'gaming', name: 'gaming' }]);
  assert.deepEqual(merged.assignments, [['code:a', 'p-trip'], ['code:b', 'p-trip'], ['code:c', 'gaming']]);
  assert.deepEqual(merged.order, [['gaming', ['code:c']], ['p-trip', ['code:a', 'code:b']]]);
  assert.deepEqual(merged.manuals.map(({ id, name }) => ({ id, name })),
    [{ id: 'p-trip', name: 'viagens' }, { id: 'gaming', name: 'gaming' }]);
});

test('refuses conflicting category assignments for same chat', () => {
  const personal = { groups: [{ id: 'a', name: 'A' }], assignments: [['code:x', 'a']], order: [], manuals: [] };
  const work = { groups: [{ id: 'b', name: 'B' }], assignments: [['code:x', 'b']], order: [], manuals: [] };
  assert.throws(() => mergeDesktopLabelSnapshots(personal, work), /Conflicting group/);
});

test('merges third profile without losing nested chat order', () => {
  const a = { groups: [{ id: 'a', name: 'Project' }], assignments: [['code:parent', 'a']],
    order: [['a', ['code:parent']]], manuals: [{ id: 'a', name: 'Project', members: ['code:parent'] }] };
  const b = { groups: [{ id: 'b', name: 'Project' }], assignments: [['code:child', 'b']],
    order: [['b', ['code:parent', 'code:child']]], manuals: [{ id: 'b', name: 'Project', members: ['code:child'] }] };
  const c = { groups: [{ id: 'c', name: 'Project' }], assignments: [['code:third', 'c']],
    order: [['c', ['code:child', 'code:third']]], manuals: [{ id: 'c', name: 'Project', members: ['code:third'] }] };
  const merged = mergeDesktopLabelSnapshots(a, b, c);
  assert.deepEqual(merged.assignments, [['code:child', 'a'], ['code:parent', 'a'], ['code:third', 'a']]);
  assert.deepEqual(merged.order, [['a', ['code:parent', 'code:child', 'code:third']]]);
  assert.deepEqual(merged.manuals[0].members, ['code:parent', 'code:child', 'code:third']);
});

const snap = (groups, assignments, extra = {}) => ({ groups, assignments, order: [], manuals: [], ...extra });

test('reports conflicts instead of aborting the three-way merge', () => {
  const a = snap([{ id: 'a', name: 'A' }], [['code:x', 'a'], ['code:y', 'a']]);
  const b = snap([{ id: 'b', name: 'B' }], [['code:x', 'b']]);
  const merged = mergeDesktopLabelSnapshotsThreeWay([a, b]);
  assert.deepEqual(merged.conflicts, [{ chat: 'code:x', groups: ['a', 'b'] }]);
  assert.deepEqual(merged.assignments, [['code:x', 'a'], ['code:y', 'a']]);
});

test('propagates deleted groups and removed assignments using the baseline', () => {
  const baseline = { profiles: ['p', 'w'], groups: [{ id: 'g1', name: 'One' }, { id: 'g2', name: 'Two' }],
    assignments: [['code:a', 'g1'], ['code:b', 'g1'], ['code:c', 'g2']], order: [], manuals: [] };
  const personal = snap([{ id: 'g1', name: 'One' }], [['code:a', 'g1'], ['code:b', 'g1']],
    { known: ['code:a', 'code:b', 'code:c'] });
  const work = snap([{ id: 'g1', name: 'One' }, { id: 'g2', name: 'Two' }],
    [['code:a', 'g1'], ['code:c', 'g2']], { known: ['code:a', 'code:b', 'code:c'] });
  const merged = mergeDesktopLabelSnapshotsThreeWay([personal, work], { baseline, ids: ['p', 'w'] });
  assert.deepEqual(merged.groups.map((group) => group.id), ['g1']);
  assert.deepEqual(merged.assignments, [['code:a', 'g1']]);
  assert.deepEqual(merged.conflicts, []);
});

test('does not treat a chat unknown to a profile as removed there', () => {
  const baseline = { profiles: ['p', 'w'], groups: [{ id: 'g1', name: 'One' }],
    assignments: [['code:a', 'g1'], ['code:b', 'g1']], order: [], manuals: [] };
  const personal = snap([{ id: 'g1', name: 'One' }], [['code:a', 'g1'], ['code:b', 'g1']], { known: ['code:a', 'code:b'] });
  const work = snap([{ id: 'g1', name: 'One' }], [['code:a', 'g1']], { known: ['code:a'] });
  const merged = mergeDesktopLabelSnapshotsThreeWay([personal, work], { baseline, ids: ['p', 'w'] });
  assert.deepEqual(merged.assignments, [['code:a', 'g1'], ['code:b', 'g1']]);
});

test('propagates a renamed group without duplicating it', () => {
  const baseline = { profiles: ['p', 'w'], groups: [{ id: 'g1', name: 'Old' }],
    assignments: [['code:a', 'g1']], order: [], manuals: [{ id: 'g1', name: 'Old', members: [] }] };
  const personal = snap([{ id: 'g1', name: 'New' }], [['code:a', 'g1']],
    { manuals: [{ id: 'g1', name: 'New', members: [] }] });
  const work = snap([{ id: 'g1', name: 'Old' }], [['code:a', 'g1']],
    { manuals: [{ id: 'g1', name: 'Old', members: [] }] });
  const merged = mergeDesktopLabelSnapshotsThreeWay([work, personal], { baseline, ids: ['w', 'p'] });
  assert.deepEqual(merged.groups, [{ id: 'g1', name: 'New' }]);
  assert.equal(merged.manuals[0].name, 'New');
});

test('a profile outside the baseline never deletes anything', () => {
  const baseline = { profiles: ['p'], groups: [{ id: 'g1', name: 'One' }], assignments: [['code:a', 'g1']], order: [], manuals: [] };
  const personal = snap([{ id: 'g1', name: 'One' }], [['code:a', 'g1']]);
  const fresh = snap([], []);
  const merged = mergeDesktopLabelSnapshotsThreeWay([personal, fresh], { baseline, ids: ['p', 'new'] });
  assert.deepEqual(merged.groups.map((group) => group.id), ['g1']);
});

test('keeps two groups with equal names inside one snapshot from crashing', () => {
  const merged = mergeDesktopLabelSnapshots(snap([{ id: 'a', name: 'Dup' }, { id: 'b', name: 'Dup' }], [['code:x', 'b']]));
  assert.equal(merged.groups.length, 1);
  assert.deepEqual(merged.assignments, [['code:x', 'a']]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAutomaticLabelSource, chooseInitialLabelSource, mergeDesktopLabelSnapshots } from './desktop-auto-label-sync.js';

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

test('initializes only from matching profiles', () => {
  assert.equal(chooseAutomaticLabelSource({ personal: 'a', work: 'a' }, null), 'personal');
  assert.equal(chooseAutomaticLabelSource({ personal: 'a', work: 'b' }, null), null);
});

test('follows sole changed profile, including deletions', () => {
  const baseline = { personal: 'a', work: 'a' };
  assert.equal(chooseAutomaticLabelSource({ personal: 'b', work: 'a' }, baseline), 'personal');
  assert.equal(chooseAutomaticLabelSource({ personal: 'a', work: 'b' }, baseline), 'work');
});

test('refuses simultaneous changes', () => {
  assert.equal(chooseAutomaticLabelSource({ personal: 'b', work: 'c' },
    { personal: 'a', work: 'a' }), null);
});

test('initial sync accepts only consistent superset', () => {
  const personal = { groups: [{ id: 'g' }], manuals: [], assignments: [['a', 'g']], order: [['g', ['a']]] };
  const work = { groups: [{ id: 'g' }], manuals: [], assignments: [['a', 'g'], ['b', 'g']], order: [['g', ['a', 'b']]] };
  assert.equal(chooseInitialLabelSource(personal, work), 'work');
  assert.equal(chooseInitialLabelSource(work, personal), 'personal');
  assert.equal(chooseInitialLabelSource(personal, { ...work, assignments: [['a', 'other']] }), null);
});

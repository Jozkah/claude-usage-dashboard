import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAutomaticLabelSource, chooseInitialLabelSource } from './desktop-auto-label-sync.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleUsageWindows } from './plan-limits.js';

test('removes five-hour window from Max and Ultra', () => {
  const windows = [{ key: 'five_hour' }, { key: 'seven_day' }];
  for (const plan of ['Max 5x', 'Max 20x', 'Max (x5)', 'Ultra (x20)', 'Ultra']) {
    assert.deepEqual(visibleUsageWindows(plan, windows), [{ key: 'seven_day' }]);
  }
  for (const plan of ['Enterprise', 'Team', 'Pro', 'Free', null]) {
    assert.deepEqual(visibleUsageWindows(plan, windows), windows);
  }
  assert.deepEqual(windows, [{ key: 'five_hour' }, { key: 'seven_day' }]);
});

test('tolerates odd input and plan spelling', () => {
  const windows = [{ key: 'five_hour' }, { key: 'seven_day' }];
  assert.equal(visibleUsageWindows('Max 5x', undefined), undefined);
  assert.equal(visibleUsageWindows('Max 5x', null), null);
  for (const plan of ['max 5x', '  MAX 20X ', 'Max  5x']) {
    assert.deepEqual(visibleUsageWindows(plan, windows), [{ key: 'seven_day' }], plan);
  }
  // only the documented Max tiers hide the five-hour window
  assert.deepEqual(visibleUsageWindows('Max 10x', windows), windows);
});

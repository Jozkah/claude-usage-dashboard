import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleUsageWindows } from './plan-limits.js';

test('removes five-hour window from Max 5x and Max 20x only', () => {
  const windows = [{ key: 'five_hour' }, { key: 'seven_day' }];
  for (const plan of ['Max 5x', 'Max 20x']) {
    assert.deepEqual(visibleUsageWindows(plan, windows), [{ key: 'seven_day' }]);
  }
  for (const plan of ['Enterprise', 'Team', 'Pro', 'Ultra', null]) {
    assert.deepEqual(visibleUsageWindows(plan, windows), windows);
  }
  assert.deepEqual(windows, [{ key: 'five_hour' }, { key: 'seven_day' }]);
});

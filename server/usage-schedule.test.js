import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReset, nextUsagePollAt } from './usage-schedule.js';

test('estimates weekly reset from saved schedule but not rolling five-hour reset', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.deepEqual(nextReset({ key: 'seven_day', resetsAt: '2026-10-14T07:00:00Z' }, now, true),
    { at: Date.parse('2026-11-04T07:00:00Z'), estimated: true });
  assert.equal(nextReset({ key: 'five_hour', resetsAt: '2026-10-17T17:00:00Z' }, now, true), null);
});

test('holds capped account until reset, keeps uncapped account polling', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const window = { key: 'seven_day', used: 100, resetsAt: '2026-11-04T07:00:00Z' };
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [window] }, now), Date.parse('2026-11-04T07:00:00Z'));
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [{ ...window, used: 99 }] }, now), now);
  assert.equal(nextUsagePollAt({ status: 'ok', stale: true, windows: [{ ...window, resetsAt: '2026-10-14T07:00:00Z' }] }, now), Date.parse('2026-11-04T07:00:00Z'));
});

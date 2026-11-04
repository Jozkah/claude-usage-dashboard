import test from 'node:test';
import assert from 'node:assert/strict';
import { nextReset, nextUsagePollAt, RESET_GRACE_MS } from './usage-schedule.js';

test('estimates weekly reset from saved schedule but not rolling five-hour reset', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.deepEqual(nextReset({ key: 'seven_day', resetsAt: '2026-10-14T07:00:00Z' }, now, true),
    { at: Date.parse('2026-11-04T07:00:00Z'), estimated: true });
  assert.equal(nextReset({ key: 'five_hour', resetsAt: '2026-10-17T17:00:00Z' }, now, true), null);
});

test('holds capped account until reset, keeps uncapped account polling', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const window = { key: 'seven_day', used: 100, resetsAt: '2026-11-04T07:00:00Z' };
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [window] }, now), Date.parse('2026-11-04T07:00:00Z') + RESET_GRACE_MS);
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [{ ...window, used: 99 }] }, now), now);
  assert.equal(nextUsagePollAt({ status: 'ok', stale: true, windows: [{ ...window, resetsAt: '2026-10-14T07:00:00Z' }] }, now), Date.parse('2026-11-04T07:00:00Z') + RESET_GRACE_MS);
});

test('nextReset handles invalid input, future resets, week boundaries and seven_day variants', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(nextReset({ key: 'seven_day' }, now), null);
  assert.equal(nextReset({ key: 'seven_day', resetsAt: 'nonsense' }, now, true), null);
  assert.equal(nextReset(null, now), null);
  assert.deepEqual(nextReset({ key: 'seven_day', resetsAt: '2026-11-03T00:00:00Z' }, now), { at: Date.parse('2026-11-03T00:00:00Z'), estimated: false });
  assert.deepEqual(nextReset({ key: 'seven_day', resetsAt: '2026-11-03T00:00:00Z' }, now, true), { at: Date.parse('2026-11-03T00:00:00Z'), estimated: true });
  // reset exactly now on a stale schedule rolls to the next week
  const exact = '2026-11-02T12:00:00Z';
  assert.equal(nextReset({ key: 'seven_day', resetsAt: exact }, now, true).at, now + 7 * 864e5);
  assert.equal(nextReset({ key: 'seven_day', resetsAt: exact }, now, false), null);
  // other seven_day* keys use the weekly estimate
  assert.equal(nextReset({ key: 'seven_day_opus', resetsAt: '2026-10-14T07:00:00Z' }, now, true).estimated, true);
});

test('nextUsagePollAt picks latest of several limiting windows and polls now when unsure', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const a = { key: 'five_hour', used: 100, resetsAt: '2026-11-02T15:00:00Z' };
  const b = { key: 'seven_day', used: 100, resetsAt: '2026-11-04T07:00:00Z' };
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [a, b] }, now, 0), Date.parse('2026-11-04T07:00:00Z'));
  assert.equal(nextUsagePollAt({ status: 'error', windows: [a, b] }, now), now);
  assert.equal(nextUsagePollAt(null, now), now);
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [a, { ...b, resetsAt: null }] }, now), now);
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [{ ...a, resetsAt: '2026-11-01T00:00:00Z' }] }, now), now);
});

test('ignores non five_hour/seven_day windows when deciding poll hold', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const cap = { key: 'seven_day', used: 100, resetsAt: '2026-11-04T07:00:00Z' };
  const extra = { key: 'extra_usage', used: 100, resetsAt: null };
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [cap, extra] }, now), Date.parse('2026-11-04T07:00:00Z') + RESET_GRACE_MS);
  assert.equal(nextUsagePollAt({ status: 'ok', windows: [extra] }, now), now);
});

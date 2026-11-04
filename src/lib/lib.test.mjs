// Run with: node --test src/lib/   (Node 22.6+ strips the TypeScript types natively; no extra dependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtAgo, fmtDur, headroom, levelFor, paceFor, windowLength } from './format.ts';
import { accountReset, nextReset } from './reset.ts';

const HOUR = 3600e3;
const DAY = 864e5;

test('levelFor thresholds', () => {
  assert.equal(levelFor(59.9), 'good');
  assert.equal(levelFor(60), 'warn');
  assert.equal(levelFor(85), 'bad');
});

test('fmtDur', () => {
  assert.equal(fmtDur(NaN), 'now');
  assert.equal(fmtDur(500), 'now');
  assert.equal(fmtDur(-5), 'now');
  assert.equal(fmtDur(5000), '5s');
  assert.equal(fmtDur(61e3), '1m 01s');
  assert.equal(fmtDur(2 * HOUR + 5 * 60e3), '2h 05m');
  assert.equal(fmtDur(3 * DAY + 4 * HOUR), '3d 4h');
});

test('fmtAgo moves on to hours and days', () => {
  assert.equal(fmtAgo(2000), 'just now');
  assert.equal(fmtAgo(30e3), '30s ago');
  assert.equal(fmtAgo(5 * 60e3), '5m ago');
  assert.equal(fmtAgo(125 * 60e3), '2h ago');
  assert.equal(fmtAgo(3 * DAY), '3d ago');
});

test('windowLength', () => {
  assert.equal(windowLength('five_hour'), 5 * HOUR);
  assert.equal(windowLength('seven_day_opus'), 7 * DAY);
  assert.equal(windowLength('other'), null);
});

test('headroom uses the tightest main window', () => {
  const a = { windows: [{ key: 'five_hour', used: 30 }, { key: 'seven_day', used: 80 }, { key: 'seven_day_opus', used: 99 }] };
  assert.equal(headroom(a), 20);
  assert.equal(headroom({}), 0);
});

test('paceFor', () => {
  const now = Date.now();
  const w = (used, elapsed) => ({ key: 'five_hour', used, resetsAt: new Date(now + (1 - elapsed) * 5 * HOUR).toISOString() });
  assert.equal(paceFor(w(90, 0.5), now).label, 'Burning fast');
  assert.equal(paceFor(w(10, 0.5), now).label, 'Room to spare');
  assert.equal(paceFor(w(50, 0.5), now).label, 'On pace');
  assert.equal(paceFor(w(50, 0.01), now), null);
});

test('nextReset rolls a stale weekly window forward', () => {
  const now = Date.now();
  const past = new Date(now - 2 * DAY).toISOString();
  assert.equal(nextReset({ key: 'seven_day', resetsAt: past }, now, false), null);
  const r = nextReset({ key: 'seven_day', resetsAt: past }, now, true);
  assert.ok(r.estimated && r.at > now && r.at - now <= 7 * DAY);
  assert.equal(nextReset({ key: 'five_hour', resetsAt: past }, now, true), null);
});

test('accountReset prefers nextPollAt for a stale, exhausted window', () => {
  const now = Date.now();
  const account = { stale: true, nextPollAt: now + 1000 };
  const w = { key: 'five_hour', used: 100, resetsAt: new Date(now - HOUR).toISOString() };
  assert.deepEqual(accountReset(account, w, now), { at: now + 1000, estimated: true });
});

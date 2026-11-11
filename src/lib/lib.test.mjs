// Run with: node --test src/lib/   (Node 22.6+ strips the TypeScript types natively; no extra dependency)
import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedFraction, fmtAgo, fmtDur, headroom, isIdle, levelFor, mainWindows, modelName, paceFor, windowLength } from './format.ts';
import { menuIndex, movedTooFar, tabTarget } from './keyboard.ts';
import { mergeHistory } from './api.ts';
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
  assert.equal(paceFor(w(90, 0.5), now).label, 'Over pace');
  assert.equal(paceFor(w(10, 0.5), now).label, 'Under pace');
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

test('tabTarget wraps Tab inside a focus trap', () => {
  assert.equal(tabTarget(3, 2, false), 0); // Tab on last -> first
  assert.equal(tabTarget(3, 0, true), 2); // Shift+Tab on first -> last
  assert.equal(tabTarget(3, 1, false), null); // middle: browser decides
  assert.equal(tabTarget(3, -1, false), 0); // focus escaped the trap: pull it back
  assert.equal(tabTarget(3, -1, true), 2);
  assert.equal(tabTarget(1, 0, false), 0);
  assert.equal(tabTarget(0, -1, false), -1); // nothing focusable: hold focus
});

test('menuIndex implements roving focus', () => {
  assert.equal(menuIndex('ArrowDown', 0, 3), 1);
  assert.equal(menuIndex('ArrowDown', 2, 3), 0);
  assert.equal(menuIndex('ArrowUp', 0, 3), 2);
  assert.equal(menuIndex('ArrowUp', -1, 3), 2);
  assert.equal(menuIndex('Home', 2, 3), 0);
  assert.equal(menuIndex('End', 0, 3), 2);
  assert.equal(menuIndex('a', 0, 3), null);
  assert.equal(menuIndex('ArrowDown', -1, 0), null);
});

test('movedTooFar tells a scroll from a long press', () => {
  assert.equal(movedTooFar(3, 4), false);
  assert.equal(movedTooFar(0, 11), true);
});

test('mergeHistory replaces from the first new timestamp and trims old points', () => {
  const prev = [[1, 10], [2, 20], [3, 30]];
  assert.deepEqual(mergeHistory(prev, [[3, 31], [4, 40]], 0), [[1, 10], [2, 20], [3, 31], [4, 40]]);
  assert.deepEqual(mergeHistory(prev, [], 2), [[2, 20], [3, 30]]);
  // a server that ignores `since` sends the whole range: it simply replaces what we had
  assert.deepEqual(mergeHistory(prev, [[1, 11], [2, 21], [3, 31], [4, 41]], 0), [[1, 11], [2, 21], [3, 31], [4, 41]]);
  assert.deepEqual(mergeHistory(prev, [[4, 40]], 3), [[3, 30], [4, 40]]);
});

test('modelName', () => {
  assert.equal(modelName('claude-sonnet-4-5-20250929'), 'Claude Sonnet 4.5');
  assert.equal(modelName('claude-opus-4-1'), 'Claude Opus 4.1');
  assert.equal(modelName('claude-3-5-sonnet-20241022'), 'Claude Sonnet 3.5');
  assert.equal(modelName('claude-3-opus-latest'), 'Claude Opus 3');
  assert.equal(modelName('us.anthropic.claude-sonnet-4-20250514-v1:0'), 'Claude Sonnet 4');
  assert.equal(modelName('unknown'), 'Unknown model');
  assert.equal(modelName('gpt-6-sol'), 'GPT-6 Sol');
  assert.equal(modelName('gpt-5.6-sol'), 'GPT-5.6 Sol');
  assert.equal(modelName('codex-auto-review'), 'Codex Auto Review');
  assert.equal(modelName('gemini-2.5-pro'), 'Gemini 2.5 Pro');
  assert.equal(modelName('qwen3.8-27b'), 'Qwen3.8 27B');
  assert.equal(modelName('big-pickle'), 'Big Pickle');
  assert.equal(modelName('deepseek-v3'), 'DeepSeek V3');
  assert.equal(modelName('o3-mini'), 'o3 Mini');
  assert.equal(modelName('openai/gpt-5'), 'GPT-5');
  assert.equal(modelName('/data/models/satgeze/Hy3-1M-GGUF/hy3-1M-MTP-Q4_K_M.gguf'), 'Hy3 1M MTP (Q4_K_M)');
});

test('elapsedFraction and mainWindows', () => {
  const now = Date.now();
  const w = { key: 'five_hour', used: 10, resetsAt: new Date(now + 2.5 * HOUR).toISOString() };
  assert.ok(Math.abs(elapsedFraction(w, now) - 0.5) < 1e-6);
  assert.equal(elapsedFraction({ key: 'five_hour', used: 1, resetsAt: new Date(now - HOUR).toISOString() }, now), null);
  assert.equal(elapsedFraction({ key: 'other', used: 1, resetsAt: w.resetsAt }, now), null);
  const extra = { key: 'seven_day_opus', used: 5 };
  assert.deepEqual(mainWindows({ windows: [extra, { key: 'a' }, { key: 'b' }] }).map((x) => x.key), ['seven_day_opus', 'a']);
  assert.deepEqual(mainWindows({ windows: [extra, w] }), [w]);
});

test('isIdle only for readable accounts with zero usage and no chat running', () => {
  const idle = { status: 'ok', windows: [{ key: 'five_hour', used: 0 }, { key: 'seven_day', used: 0 }], sessions: [] };
  assert.equal(isIdle(idle), true);
  assert.equal(isIdle({ ...idle, windows: [{ key: 'five_hour', used: 0 }, { key: 'seven_day', used: 3 }] }), false);
  assert.equal(isIdle({ ...idle, sessions: [{ working: true }] }), false);
  assert.equal(isIdle({ ...idle, status: 'expired' }), false);
  assert.equal(isIdle({ status: 'ok', windows: [] }), false);
});

import { planTier } from './plan.ts';
test('planTier maps Claude and Codex plan names to colour tiers', () => {
  assert.equal(planTier('Max 20x'), 'max20');
  assert.equal(planTier('Ultra (x20)'), 'max20');
  assert.equal(planTier('Max (x5)'), 'max5');
  assert.equal(planTier('Max 5x'), 'max5');
  assert.equal(planTier('Team'), 'team');
  assert.equal(planTier('Team (Premium)'), 'team');
  assert.equal(planTier('Pro'), 'pro');
  assert.equal(planTier('Codex Plus'), 'plus');
  assert.equal(planTier('Codex Pro'), 'pro');
  assert.equal(planTier('Enterprise'), 'business');
  assert.equal(planTier(null), 'unknown');
  assert.equal(planTier('Mystery'), 'unknown');
});

import { checkpoints, paceBand, paceInfo, valueAt } from './pace.ts';

test('checkpoints: a block per day, today since the last midnight', () => {
  const now = new Date(2026, 10, 11, 15, 0).getTime(); // Wed 15:00
  const end = new Date(2026, 10, 14, 7, 0).getTime();
  const w = { key: 'seven_day', label: 'Weekly', used: 40, resetsAt: new Date(end).toISOString() };
  const start = end - 7 * DAY;
  const at = (d, h, v) => [new Date(2026, 10, d, h, 0).getTime(), v];
  const pts = [[start + HOUR, 1], at(8, 23, 8), at(9, 1, 10), at(9, 23, 20), at(10, 1, 22), at(10, 23, 30), at(11, 1, 32), at(11, 12, 38)];
  const c = checkpoints(pts, w, now);
  assert.equal(c.unit, 'day');
  assert.deepEqual(c.marks.map((m) => m.used === null ? null : Math.round(m.used)).slice(-3), [21, 31, 40]);
  assert.equal(Math.round(c.sinceLast), 9); // 40 now, 31 at the last midnight
  assert.equal(Math.round(c.previous), 10); // 31 - 21
});

test('checkpoints: unknown without a reset or after the window ended', () => {
  assert.equal(checkpoints([], { key: 'seven_day', label: 'W', used: 5 }, Date.now()), null);
  assert.equal(checkpoints([], { key: 'seven_day', label: 'W', used: 5, expired: true, resetsAt: new Date(Date.now() + DAY).toISOString() }, Date.now()), null);
});

test('valueAt interpolates close readings and refuses stale ones', () => {
  const pts = [[0, 10], [HOUR, 20]];
  assert.equal(Math.round(valueAt(pts, HOUR / 2)), 15);
  assert.equal(valueAt(pts, -1), null);
  assert.equal(valueAt(pts, 20 * HOUR), null); // the last reading is too old to trust
});

test('paceInfo projects from the recent rate and flags a limit that will run out', () => {
  const now = Date.now();
  const w = { key: 'five_hour', label: '5h', used: 60, resetsAt: new Date(now + 2 * HOUR).toISOString() };
  // 3h elapsed, 60% used; the last hour alone added 30%: ~30%/h
  const pts = [[now - 3 * HOUR, 0], [now - HOUR, 30], [now, 60]];
  const p = paceInfo(pts, w, now);
  assert.equal(p.tone, 'bad');
  assert.match(p.label, /Runs out in/);
  assert.ok(p.runsOutAt < now + 2 * HOUR);
  assert.ok(p.projected >= 100);
});

test('paceInfo: a slow week has room to spare and reports a daily allowance', () => {
  const now = Date.now();
  const w = { key: 'seven_day', label: 'Weekly', used: 20, resetsAt: new Date(now + 3.5 * DAY).toISOString() };
  const pts = [[now - 3.5 * DAY, 0], [now - DAY, 14], [now, 20]];
  const p = paceInfo(pts, w, now);
  assert.equal(p.tone, 'good');
  assert.equal(p.perUnit, 'day');
  assert.ok(Math.abs(p.allowance - 80 / 3.5) < 0.01);
  assert.equal(paceInfo(pts, { ...w, resetsAt: undefined }, now), null);
  assert.equal(paceInfo(pts, { ...w, used: 100 }, now).label, 'Limit reached');
});

import { initials, poolLimits } from './pool.ts';

test('poolLimits: one row per limit, one segment per account, pooled mean and refill', () => {
  const now = Date.now();
  const win = (key, used, ms) => ({ key, label: key, used, resetsAt: new Date(now + ms).toISOString() });
  const acc = (id, name, windows, status = 'ok') => ({ id, name, status, windows });
  const accounts = [
    acc('a', 'Personal', [win('five_hour', 74, 2.5 * HOUR), win('seven_day', 99, 3 * DAY)]),
    acc('b', 'Work 2', [win('five_hour', 0, 5 * HOUR), win('seven_day', 0, 7 * DAY)]),
    acc('c', 'Broken', [], 'error'),
  ];
  const [g] = poolLimits(accounts, () => 'claude', now);
  assert.deepEqual(g.rows.map((r) => r.label), ['Session', 'Weekly']);
  const session = g.rows[0];
  assert.equal(session.segments.length, 3);
  assert.equal(session.segments[2].left, null); // account without a reading keeps its slot
  assert.equal(Math.round(session.left), 63);   // (26 + 100) / 2
  assert.equal(Math.round(session.refill), 37);
  assert.equal(Math.round(session.resetIn / HOUR * 10) / 10, 2.5);
  assert.equal(session.pace.label, 'Over pace'); // 37% used against a mean of 25% of the window gone: 12 points ahead
});

test('poolLimits groups providers separately and skips expired windows; initials', () => {
  const now = Date.now();
  const exp = { key: 'five_hour', label: 'x', used: 10, expired: true, resetsAt: new Date(now - HOUR).toISOString() };
  const groups = poolLimits([
    { id: 'a', name: 'A', status: 'ok', windows: [exp] },
    { id: 'c', name: 'Codex', status: 'ok', windows: [{ key: 'seven_day', label: 'Weekly', used: 16, resetsAt: new Date(now + DAY).toISOString() }] },
  ], (a) => (a.id === 'c' ? 'codex' : 'claude'), now);
  assert.deepEqual(groups.map((g) => g.provider), ['codex']);
  assert.equal(initials('Work (Shared)'), 'WS');
  assert.equal(initials('Work 2'), 'W2');
  assert.equal(initials('Codex'), 'CO');
});

test('paceBand is the shared pace rule: 8 points either side of even pacing is on pace', () => {
  assert.equal(paceBand(58, 0.5).label, 'On pace');
  assert.equal(paceBand(59, 0.5).label, 'Over pace');
  assert.equal(paceBand(42, 0.5).label, 'On pace');
  assert.equal(paceBand(41, 0.5).label, 'Under pace');
  assert.equal(paceBand(41, 0.5).tone, 'good');
});

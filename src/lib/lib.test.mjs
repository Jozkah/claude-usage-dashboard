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
  assert.equal(planTier('Pro'), 'pro');
  assert.equal(planTier('Codex Plus'), 'plus');
  assert.equal(planTier('Codex Pro'), 'pro');
  assert.equal(planTier('Enterprise'), 'business');
  assert.equal(planTier(null), 'unknown');
  assert.equal(planTier('Mystery'), 'unknown');
});

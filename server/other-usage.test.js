import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOtherUsageStore, mergeReports } from './other-usage.js';

const NOW = new Date(2026, 10, 4, 18).getTime();
const ctx = (model, cwd) => JSON.stringify({ timestamp: '2026-11-04T12:00:00', type: 'turn_context', payload: { model, cwd } });
const tc = (total, last) => JSON.stringify({ timestamp: '2026-11-04T12:00:01', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total }, last_token_usage: last } } });

test('Codex: token_count events become per-model usage; a repeated event counts once', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'other-usage-'));
  try {
    const dir = path.join(home, 'sessions', '2026', '11', '04');
    fs.mkdirSync(dir, { recursive: true });
    const last = { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 10 };
    fs.writeFileSync(path.join(dir, 'rollout-2026-11-04T12-00-00-01a18fa6-0434-73f0-acce-50cdd494505a.jsonl'),
      [ctx('gpt-x', String.raw`C:\Users\me\Coding\my-app`), tc(1050, last), tc(1050, last), tc(2100, last)].join('\n') + '\n');
    const s = createOtherUsageStore({ now: () => NOW });
    await s.scanOnce({ codexHomes: [home], openCodeDb: path.join(home, 'none.db') });
    const day = s.getDays(7, NOW)[0];
    const c = day.clients.Codex;
    assert.deepEqual([c.requests, c.input, c.cacheRead, c.output, c.reasoning], [2, 800, 1200, 100, 20]);
    assert.equal(c.models[0].name, 'gpt-x');
    assert.equal(c.projects[0].name, 'my-app');
    assert.equal(c.unpriced, c.total); // no public price known
    await s.scanOnce({ codexHomes: [home], openCodeDb: path.join(home, 'none.db') }); // nothing new: unchanged
    assert.equal(s.getDays(7, NOW)[0].clients.Codex.requests, 2);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('mergeReports sums clients into each day and keeps a per-client slice', () => {
  const claude = { ready: true, days: [{ date: '2026-11-04', requests: 5, failed: 1, canceled: 0, input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100, cost: 2, unpriced: 0, models: [{ name: 'claude-opus-5-5', tokens: 100, cost: 2 }], projects: [{ name: 'a', tokens: 100, cost: 2 }] }] };
  const codex = { requests: 2, failed: 0, canceled: 0, input: 1, output: 2, cacheRead: 3, cacheWrite: 0, reasoning: 1, total: 6, cost: 0, unpriced: 6, models: [{ name: 'gpt-x', tokens: 6, cost: 0, requests: 2, input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }], projects: [{ name: 'a', tokens: 6, cost: 0 }] };
  const out = mergeReports(claude, [{ date: '2026-11-04', clients: { Codex: codex } }, { date: '2026-11-03', clients: { Codex: codex } }]);
  assert.deepEqual(out.days.map((d) => d.date), ['2026-11-04', '2026-11-03']);
  const d = out.days[0];
  assert.deepEqual([d.requests, d.total, d.failed], [7, 106, 1]);
  assert.deepEqual(Object.keys(d.clients), ['Claude Code', 'Codex']);
  assert.equal(d.models.length, 2);
  assert.equal(d.projects[0].tokens, 106);
  assert.equal(out.days[1].clients.Codex.total, 6);
});

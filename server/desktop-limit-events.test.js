import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDesktopLimitReader } from './desktop-limit-events.js';

test('maps Desktop limit event to CLI chat and clears it on recovery', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-limit-'));
  const logDir = path.join(profile, 'logs');
  fs.mkdirSync(logDir);
  const log = path.join(logDir, 'main.log');
  const local = 'local_7b831a0c-c247-4251-8aa3-a0a0c074e145';
  const cli = '266a5e72-9522-43d1-b68e-8609773e64d2';
  const read = createDesktopLimitReader({ now: () => new Date('2026-11-07T16:40:00').getTime() });
  try {
    fs.writeFileSync(log, `2026-11-07 16:35:12 [info] Mapping internal session ${local} to CLI session ${cli}\n` +
      `2026-11-07 16:35:13 [warn] [CCD CycleHealth] ${local} api_error (success): You've hit your 5-hour limit · resets 5:20pm (Europe/Lisbon)\n`);
    assert.ok(read(profile).get(cli) > Date.now() - 365 * 24 * 3600e3);
    fs.appendFileSync(log, `2026-11-07 17:20:05 [info] [CCD CycleHealth] healthy cycle for ${local} (6s, hadFirstResponse=true)\n`);
    assert.equal(read(profile).size, 0);
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
});

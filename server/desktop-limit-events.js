import fs from 'node:fs';
import path from 'node:path';

const mapping = /Mapping internal session (local_[\w-]+) to CLI session ([\da-f-]{36})/i;
const limit = /\[CCD CycleHealth\] (local_[\w-]+) api_error .*hit your 5-hour limit.*resets (\d{1,2}):(\d{2})(am|pm)/i;
const healthy = /\[CCD CycleHealth\] healthy cycle for (local_[\w-]+)/i;

function resetAt(line, hour, minute, meridiem) {
  const date = line.slice(0, 10);
  const clock = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(clock.getTime())) return 0;
  clock.setHours(Number(hour) % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0), Number(minute), 0, 0);
  const event = new Date(line.slice(0, 19)).getTime();
  if (clock.getTime() < event) clock.setDate(clock.getDate() + 1);
  return clock.getTime();
}

/** Read Claude Desktop's own cycle-health events; no screenshots or credentials. */
export function createDesktopLimitReader({ now = Date.now } = {}) {
  const files = new Map();
  return function read(profile) {
    const file = path.join(profile, 'logs', 'main.log');
    let stat;
    try { stat = fs.statSync(file); } catch { return new Map(); }
    let state = files.get(file);
    if (!state || stat.size < state.offset) {
      state = { offset: 0, remainder: '', cli: new Map(), paused: new Map() };
      files.set(file, state);
    }
    if (stat.size > state.offset) {
      const length = stat.size - state.offset;
      const buffer = Buffer.alloc(length);
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, buffer, 0, length, state.offset); } finally { fs.closeSync(fd); }
      state.offset = stat.size;
      const lines = (state.remainder + buffer.toString('utf8')).split(/\r?\n/);
      state.remainder = lines.pop() || '';
      for (const line of lines) {
        const linked = line.match(mapping);
        if (linked) state.cli.set(linked[1], linked[2]);
        const blocked = line.match(limit);
        if (blocked) state.paused.set(blocked[1], resetAt(line, blocked[2], blocked[3], blocked[4]));
        const recovered = line.match(healthy);
        if (recovered) state.paused.delete(recovered[1]);
      }
    }
    const result = new Map();
    for (const [internal, until] of state.paused) {
      if (until <= now()) { state.paused.delete(internal); continue; }
      const cli = state.cli.get(internal);
      if (cli) result.set(cli, until);
    }
    return result;
  };
}

import fs from 'node:fs';
import path from 'node:path';

// Codex chats: every thread is a rollout-*.jsonl under <CODEX_HOME>/sessions/YYYY/MM/DD/ (a long-lived thread keeps
// writing to the file of the day it started). Only the head and tail of each file are read, they can be tens of MB.
// A chat counts as open when its file changed recently; "working" when its last turn event is a started task.
export const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
export const WORKING_WINDOW_MS = 5 * 60 * 1000;
const TAIL_BYTES = 256 * 1024;
const HEAD_BYTES = 512 * 1024;
const LIST_TTL_MS = 3000;

function rolloutFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

function readSlice(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, read).toString('utf8');
  } finally { fs.closeSync(fd); }
}

/** Last turn event in the tail: 'busy' while a task started and has not completed, else 'waiting'. */
export function turnState(tail) {
  let state = 'waiting';
  for (const line of tail.split('\n')) {
    if (!line.includes('"task_started"') && !line.includes('"task_complete"') && !line.includes('"turn_aborted"')) continue;
    if (line.includes('"task_started"')) state = 'busy';
    else state = 'waiting';
  }
  return state;
}

function threadNames(codexHome) {
  const names = new Map();
  try {
    for (const line of fs.readFileSync(path.join(codexHome, 'session_index.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      try { const j = JSON.parse(line); if (j.id && j.thread_name) names.set(j.id, j.thread_name); } catch { /* skip a bad line */ }
    }
  } catch { /* no index yet */ }
  return names;
}

const idOf = (file) => /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file)?.[1] ?? path.basename(file);

/** @param {{ now?: () => number }} [options] */
export function createCodexSessionReader({ now = Date.now } = {}) {
  const cache = new Map(); // codexHome -> { at, list }
  const folders = new Map(); // file -> folder name (cwd never changes for a thread)

  return async function readCodexSessions(codexHome) {
    const hit = cache.get(codexHome);
    if (hit && now() - hit.at < LIST_TTL_MS) return hit.list;
    const root = path.join(codexHome, 'sessions');
    const t = now();
    const recent = [];
    for (const file of rolloutFiles(root)) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (t - st.mtimeMs <= ACTIVE_WINDOW_MS) recent.push({ file, mtime: st.mtimeMs, size: st.size });
    }
    const names = recent.length ? threadNames(codexHome) : new Map();
    const list = recent.flatMap(({ file, mtime, size }) => {
      let head = '';
      try { head = readSlice(file, 0, Math.min(size, HEAD_BYTES)); } catch { return []; }
      // Codex guardian/reviewer workers are internal subagents, not user chats.
      try {
        const first = JSON.parse(head.split('\n', 1)[0]);
        if (first.type === 'session_meta' && first.payload?.source?.subagent) return [];
      } catch { /* damaged metadata: retain the chat */ }
      let busy = false;
      try { busy = t - mtime <= WORKING_WINDOW_MS && turnState(readSlice(file, Math.max(0, size - TAIL_BYTES), Math.min(size, TAIL_BYTES))) === 'busy'; } catch { /* unreadable: treat as waiting */ }
      if (!folders.has(file)) {
        let folder = null;
        try {
          const cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
          // Split on both separators: a Windows path may be read on Linux (Docker), where path.basename keeps it whole.
          if (cwd) folder = JSON.parse(`"${cwd}"`).split(/[\\/]+/).filter(Boolean).pop() ?? null;
        } catch { /* leave null */ }
        folders.set(file, folder);
      }
      const id = idOf(file);
      return [{ id, name: names.get(id) ?? null, folder: folders.get(file) ?? null, lastActiveAt: Math.round(mtime), working: busy, state: busy ? 'busy' : 'waiting' }];
    }).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    cache.set(codexHome, { at: t, list });
    return list;
  };
}

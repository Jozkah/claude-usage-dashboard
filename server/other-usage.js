/**
 * Token usage of other AI clients that keep local history, merged into the daily report next to Claude Code.
 *
 * - Codex: <CODEX_HOME>/sessions/**\/rollout-*.jsonl, one `token_count` event per model call (incremental, offsets remembered).
 * - OpenCode: <data>/opencode/opencode.db (SQLite, assistant messages carry tokens). Small, so it is re-read every round.
 * Other clients are not read: their local files hold no token counts, or this has not been checked against real data.
 * No logins or network calls are involved. Models without a known public price are counted in tokens only.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { priceFor, costOf } from './pricing.js';

const STATE_VERSION = 1;
const CHUNK = 1 << 20;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const folderOf = (cwd) => {
  const p = String(cwd || '').replace(/\\/g, '/');
  const i = p.indexOf('/.claude/worktrees/');
  return (i > 0 ? p.slice(0, i) : p).split('/').filter(Boolean).pop() || 'unknown';
};

/** A bucket is [input, output, cacheRead, cacheWrite, reasoning, requests] for one (client, model, project) on one day. */
const emptyBucket = () => [0, 0, 0, 0, 0, 0];

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

export const defaultOpenCodeDb = () => {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
};

/** @param {{ now?: () => number, chunkSize?: number }} [options] */
export function createOtherUsageStore({ now = Date.now, chunkSize = 4 * 1024 * 1024 } = {}) {
  const state = { v: STATE_VERSION, files: {}, days: {} }; // days: { day: { "[client,model,project]": bucket } } (Codex only, persisted)
  let openCode = {}; // same shape, rebuilt every round from the SQLite file
  let stateFile = null;
  let dirty = false;
  let running = false;
  const progress = { scanning: false, ready: false, updatedAt: 0 };

  function load(file) {
    stateFile = file;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && j.v === STATE_VERSION) { state.files = j.files || {}; state.days = j.days || {}; }
    } catch { /* first run */ }
  }

  async function save() {
    if (!stateFile || !dirty) return;
    dirty = false;
    const tmp = `${stateFile}.tmp`;
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(state));
      await fs.promises.rename(tmp, stateFile);
    } catch { dirty = true; }
  }

  function add(target, day, client, model, project, b) {
    const k = JSON.stringify([client, model, project]);
    const bucket = ((target[day] ||= {})[k] ||= emptyBucket());
    for (let i = 0; i < 6; i++) bucket[i] += b[i];
  }

  /* ---------------------------------- Codex ---------------------------------- */

  /** One rollout line. `f` remembers the model, folder and last running total of this file. */
  function ingestCodex(line, f) {
    if (line.includes('"turn_context"')) {
      try {
        const p = JSON.parse(line).payload;
        if (p?.model) f.model = String(p.model);
        if (p?.cwd) f.project = folderOf(p.cwd);
      } catch { /* skip */ }
      return;
    }
    if (!line.includes('"token_count"')) return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    const info = j?.payload?.type === 'token_count' ? j.payload.info : null;
    const last = info?.last_token_usage;
    if (!last) return;
    const total = Number(info.total_token_usage?.total_tokens) || 0;
    if (total && total === f.total) return; // the same event repeated: nothing new was used
    f.total = total;
    const day = dayKey(j.timestamp);
    if (!day) return;
    const cached = Number(last.cached_input_tokens) || 0;
    const written = Number(last.cache_write_input_tokens) || 0;
    const input = Math.max(0, (Number(last.input_tokens) || 0) - cached - written);
    const output = Number(last.output_tokens) || 0;
    if (!input && !output && !cached && !written) return;
    add(state.days, day, 'codex', f.model || 'unknown', f.project || 'unknown', [input, output, cached, written, Number(last.reasoning_output_tokens) || 0, 1]);
    dirty = true;
  }

  async function readCodexFile(p, f, st) {
    const fh = await fs.promises.open(p, 'r');
    try {
      if (st.size < f.offset) { f.offset = 0; f.total = 0; }
      const buf = Buffer.allocUnsafe(chunkSize);
      let pos = f.offset;
      let carry = Buffer.alloc(0);
      while (pos < st.size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, st.size - pos), pos);
        if (!bytesRead) break;
        pos += bytesRead;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        const nl = data.lastIndexOf(10);
        if (nl === -1) { carry = Buffer.from(data); continue; }
        const text = data.subarray(0, nl).toString('utf8');
        carry = Buffer.from(data.subarray(nl + 1));
        for (const line of text.split('\n')) if (line) ingestCodex(line, f);
        f.offset = pos - carry.length;
      }
      f.mtime = st.mtimeMs;
      dirty = true;
    } finally { await fh.close(); }
  }

  async function scanCodex(homes) {
    const work = [];
    for (const home of homes) {
      for (const p of rolloutFiles(path.join(home, 'sessions'))) {
        let st;
        try { st = fs.statSync(p); } catch { continue; }
        const f = (state.files[p] ||= { offset: 0 });
        if (st.size !== f.offset || (f.mtime !== undefined && st.mtimeMs !== f.mtime)) work.push([p, f, st]);
      }
    }
    let n = 0;
    for (const [p, f, st] of work) {
      try { await readCodexFile(p, f, st); } catch { /* locked or vanished: next round */ }
      if (++n % 20 === 0) await new Promise((r) => setImmediate(r));
    }
  }

  /* --------------------------------- OpenCode --------------------------------- */

  async function scanOpenCode(dbPath) {
    if (!dbPath || !fs.existsSync(dbPath)) { openCode = {}; return; }
    /** @type {any} */
    let DatabaseSync;
    const sqlite = 'node:sqlite'; // variable specifier: older Node versions lack it, and types for it may be missing
    try { ({ DatabaseSync } = await import(sqlite)); } catch { openCode = {}; return; }
    const next = {};
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 2000');
      for (const row of db.prepare("SELECT data FROM message WHERE data LIKE '%\"role\":\"assistant\"%' AND data LIKE '%\"tokens\"%'").iterate()) {
        let m;
        try { m = JSON.parse(row.data); } catch { continue; }
        const t = m?.tokens;
        const day = dayKey(m?.time?.created);
        if (!t || !day || m.role !== 'assistant') continue;
        const cache = t.cache || {};
        const b = [Number(t.input) || 0, Number(t.output) || 0, Number(cache.read) || 0, Number(cache.write) || 0, Number(t.reasoning) || 0, 1];
        if (!b[0] && !b[1] && !b[2] && !b[3]) continue;
        add(next, day, 'opencode', m.modelID || 'unknown', folderOf(m.path?.cwd), b);
      }
      openCode = next;
    } catch { /* locked or unsupported schema: keep the previous numbers */ } finally { try { db?.close(); } catch { /* ignore */ } }
  }

  async function scanOnce({ codexHomes = [], openCodeDb = defaultOpenCodeDb() } = {}) {
    if (running) return;
    running = true;
    try {
      progress.scanning = true;
      await scanCodex(codexHomes);
      await scanOpenCode(openCodeDb);
      progress.ready = true;
      progress.updatedAt = now();
      dirty = true;
      await save();
    } finally { progress.scanning = false; running = false; }
  }

  /* --------------------------------- reporting --------------------------------- */

  /** Per-day rows in the same shape as the Claude report, each with a `clients` map holding the per-client slice. */
  function getDays(days = 30, at = now()) {
    let cutoff = '';
    if (days !== Infinity) { const d = new Date(at); d.setDate(d.getDate() - (Math.max(1, days) - 1)); cutoff = dayKey(d); }
    const out = new Map();
    const names = { codex: 'Codex', opencode: 'OpenCode' };
    for (const source of [state.days, openCode]) {
      for (const [day, buckets] of Object.entries(source)) {
        if (day < cutoff) continue;
        for (const [k, b] of Object.entries(buckets)) {
          const [client, model, project] = JSON.parse(k);
          const row = out.get(day) || { date: day, clients: {} };
          out.set(day, row);
          const c = (row.clients[names[client] || client] ||= sliceOf());
          const price = priceFor(model);
          const cost = price ? costOf(price, { in: b[0], out: b[1], cr: b[2], c5: b[3], c1: 0, prompt: b[0] + b[2] + b[3] }) : 0;
          const tok = b[0] + b[1] + b[2] + b[3];
          c.requests += b[5]; c.input += b[0]; c.output += b[1]; c.cacheRead += b[2]; c.cacheWrite += b[3]; c.reasoning += b[4];
          c.total += tok; c.cost += cost; if (!price) c.unpriced += tok;
          const m = (c.models[model] ||= { name: model, tokens: 0, cost: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
          m.tokens += tok; m.cost += cost; m.requests += b[5]; m.input += b[0]; m.output += b[1]; m.cacheRead += b[2]; m.cacheWrite += b[3];
          const pr = (c.projects[project] ||= { name: project, tokens: 0, cost: 0 });
          pr.tokens += tok; pr.cost += cost;
        }
      }
    }
    return [...out.values()].map((row) => {
      for (const c of Object.values(row.clients)) { c.models = Object.values(c.models); c.projects = Object.values(c.projects); }
      return row;
    });
  }

  return { state, progress, load, save, scanOnce, getDays, ingestCodex };
}

const sliceOf = () => ({ requests: 0, failed: 0, canceled: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, cost: 0, unpriced: 0, models: {}, projects: {} });

const FIELDS = ['requests', 'failed', 'canceled', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'total', 'cost', 'unpriced'];
const mergeShares = (a, b, extra) => {
  const m = new Map();
  for (const s of [...a, ...b]) {
    const cur = m.get(s.name) || { name: s.name, tokens: 0, cost: 0 };
    cur.tokens += s.tokens; cur.cost += s.cost;
    for (const k of extra) cur[k] = (cur[k] || 0) + (s[k] || 0);
    m.set(s.name, cur);
  }
  return [...m.values()].sort((x, y) => y.tokens - x.tokens);
};
const MODEL_EXTRA = ['requests', 'input', 'output', 'cacheRead', 'cacheWrite'];

/**
 * Combine the Claude Code report with the other clients' day rows. Every day gets `clients` (name -> full slice);
 * the day itself stays the sum of all clients, so older code that ignores `clients` keeps working.
 */
export function mergeReports(claude, otherDays, claudeName = 'Claude Code') {
  const byDate = new Map();
  for (const d of claude.days) {
    const { models, projects, ...rest } = d;
    const slice = { ...rest, reasoning: 0, models: models.map((m) => ({ ...m })), projects: projects.map((p) => ({ ...p })) };
    byDate.set(d.date, { ...slice, models: slice.models, projects: slice.projects, clients: { [claudeName]: slice } });
  }
  for (const o of otherDays) {
    let day = byDate.get(o.date);
    if (!day) {
      day = { date: o.date, ...sliceOf(), models: [], projects: [], clients: {} };
      day.models = []; day.projects = [];
      byDate.set(o.date, day);
    }
    for (const [name, c] of Object.entries(o.clients)) {
      day.clients[name] = c;
      for (const k of FIELDS) day[k] = (day[k] || 0) + (c[k] || 0);
      day.models = mergeShares(day.models, c.models, MODEL_EXTRA);
      day.projects = mergeShares(day.projects, c.projects, []);
    }
  }
  return { ...claude, days: [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) };
}

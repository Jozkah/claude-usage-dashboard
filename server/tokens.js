/**
 * Per-day token and cost totals, read from the chat logs Claude Code keeps on this
 * computer (<config>/projects/**.jsonl). Same idea as the VS Code usage extension.
 *
 * - Incremental: remembers how far into each file it has read, so only new lines are parsed.
 * - Costs are ESTIMATES at public API prices, not what a subscription actually charges.
 * - Only covers this computer. Phone and other PCs never write logs here.
 * - Raw token counts are stored per day and per (model, project, price-affecting flags);
 *   cost is computed when a report is built, so price changes need no rescan.
 *   Bump STATE_VERSION when the stored layout changes: old state is dropped and logs are re-read once.
 * - Days are bucketed in the server's local timezone. The timezone is stored with the state and
 *   a change triggers one rescan.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { priceFor, costOf, promptClass, promptOfClass } from './pricing.js';

const STATE_VERSION = 4;
const SEEN_LIMIT = 100000; // committed message keys kept for de-duplication across files
const HEAD_BYTES = 64; // first and last-read bytes of a file remembered to detect a rewrite
const CHUNK_CHARS = 1 << 20; // state is serialized and written in pieces of about this size
const currentTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** First day of a `days`-long window ending today, by calendar (not 24h blocks, so DST-safe). */
const cutoffKey = (days, now) => {
  const d = new Date(now);
  d.setDate(d.getDate() - (Math.max(1, days) - 1));
  return dayKey(d);
};

function projectName(cwd) {
  if (!cwd) return 'unknown';
  const p = String(cwd).replace(/\\/g, '/');
  const i = p.indexOf('/.claude/worktrees/');
  return (i > 0 ? p.slice(0, i) : p).split('/').filter(Boolean).pop() || 'unknown';
}

const priceMemo = new Map();
function priceOf(model) {
  if (!priceMemo.has(model)) priceMemo.set(model, priceFor(model));
  return priceMemo.get(model);
}

const hashKey = (id, requestId) => crypto.createHash('sha1').update(`${id}|${requestId || ''}`).digest('base64').slice(0, 16);

/** Key of one usage bucket: [model, project, speed, tier, geo, prompt-size class]. Values are [in,out,cr,c5,c1,search]. */
const variantKey = (r) => JSON.stringify([r.model, r.project, r.speed || '', r.tier || '', r.geo || '', promptClass(r.in + r.cr + r.c5 + r.c1)]);

export function createTokenStore({ chunkSize = 8 * 1024 * 1024 } = {}) {
  const state = { v: STATE_VERSION, tz: currentTz(), files: {}, days: {} };
  let seen = new Set();
  const progress = { scanning: false, ready: false, done: 0, total: 0, updatedAt: 0 };
  let stateFile = null;
  let dirty = false;
  let saving = null;
  let running = false;
  let buf = null;
  const parsedKeys = new Map();

  function load(file) {
    stateFile = file;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && j.v === STATE_VERSION && j.tz === state.tz) {
        state.files = j.files || {};
        state.days = j.days || {};
        seen = new Set(Array.isArray(j.seen) ? j.seen : []);
        progress.ready = true;
        progress.updatedAt = j.updatedAt || 0;
      }
    } catch { /* first run */ }
  }

  /** Serialize the state in ~1 MB pieces (a consistent snapshot, no single giant JSON string), then write them async. */
  function stateChunks() {
    const chunks = [];
    let cur = [];
    let len = 0;
    const put = (str) => { cur.push(str); len += str.length; if (len >= CHUNK_CHARS) { chunks.push(cur.join('')); cur = []; len = 0; } };
    put(`{"v":${state.v},"tz":${JSON.stringify(state.tz)},"updatedAt":${Number(progress.updatedAt) || 0}`);
    for (const key of ['files', 'days']) {
      put(`,"${key}":{`);
      let first = true;
      for (const [k, v] of Object.entries(state[key])) {
        put(`${first ? '' : ','}${JSON.stringify(k)}:${JSON.stringify(v)}`);
        first = false;
      }
      put('}');
    }
    put(',"seen":[');
    let first = true;
    for (const k of seen) { put(`${first ? '' : ','}${JSON.stringify(k)}`); first = false; }
    put(']}');
    if (cur.length) chunks.push(cur.join(''));
    return chunks;
  }

  async function writeChunks(tmp, chunks) {
    const fh = await fs.promises.open(tmp, 'w');
    try { for (const c of chunks) await fh.write(c); } finally { await fh.close(); }
  }

  function save() {
    if (!stateFile || !dirty || saving) return saving;
    dirty = false;
    let chunks;
    try { chunks = stateChunks(); } catch { dirty = true; return null; }
    const tmp = stateFile + '.tmp';
    saving = writeChunks(tmp, chunks)
      .then(() => fs.promises.rename(tmp, stateFile))
      .catch(() => { dirty = true; }) // best effort
      .finally(() => { saving = null; });
    return saving;
  }

  function remember(key) {
    seen.add(key);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
  }

  function commit(r) {
    if (r.key) {
      if (seen.has(r.key)) return;
      remember(r.key);
    }
    const day = (state.days[r.day] ||= { u: {} });
    const c = (day.u[variantKey(r)] ||= [0, 0, 0, 0, 0, 0]);
    c[0] += r.in; c[1] += r.out; c[2] += r.cr; c[3] += r.c5; c[4] += r.c1; c[5] += r.search || 0;
    dirty = true;
  }

  /* A message is logged once per content block, all with the same message id. Keep the
     last block's numbers (they are final) and commit when the id changes. Ids already
     committed (any file) are skipped, so resumed or copied sessions do not double count. */
  function ingest(line, f) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    const msg = j && j.message;
    if (!j || j.type !== 'assistant' || !msg || !msg.usage) return;
    const u = msg.usage;
    const day = dayKey(j.timestamp);
    if (!day) return;
    const model = msg.model || j.requestedModel || 'unknown';
    if (model === '<synthetic>') return;
    const cc = u.cache_creation || {};
    const c1 = Number(cc.ephemeral_1h_input_tokens) || 0;
    const c5 = cc.ephemeral_5m_input_tokens != null
      ? Number(cc.ephemeral_5m_input_tokens) || 0
      : Math.max(0, (Number(u.cache_creation_input_tokens) || 0) - c1);
    const rec = {
      key: msg.id ? hashKey(msg.id, j.requestId) : null,
      day,
      model,
      project: projectName(j.cwd),
      in: Number(u.input_tokens) || 0,
      out: Number(u.output_tokens) || 0,
      cr: Number(u.cache_read_input_tokens) || 0,
      c5, c1,
      speed: u.speed,
      geo: u.inference_geo,
      tier: u.service_tier,
      search: Number(u.server_tool_use?.web_search_requests) || 0,
    };
    if (!rec.in && !rec.out && !rec.cr && !rec.c5 && !rec.c1 && !rec.search) return;
    if (f.pending && rec.key && f.pending.key === rec.key) { f.pending = rec; return; }
    if (rec.key && seen.has(rec.key)) return;
    if (f.pending) commit(f.pending);
    f.pending = rec;
  }

  /* -------------------------------- scanning -------------------------------- */

  /* Directory listings are cached by directory mtime (it changes when entries are added or removed;
     appending to a file does not touch it). The cache is rebuilt every round from the directories
     just visited, so it stays bounded to directories that still exist. */
  let dirCache = new Map();

  function walk(dir, out, visited) {
    let mtime;
    try { mtime = fs.statSync(dir).mtimeMs; } catch { return; }
    let ent = dirCache.get(dir);
    if (!ent || ent.mtime !== mtime) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      ent = { mtime, files: [], dirs: [] };
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) ent.dirs.push(p);
        else if (e.isFile() && e.name.endsWith('.jsonl')) ent.files.push(p);
      }
    }
    visited.set(dir, ent);
    for (const p of ent.files) out.push(p);
    for (const d of ent.dirs) walk(d, out, visited);
  }

  /** File was replaced or shrunk: keep what was pending, then re-read from the start (ids de-duplicate). */
  function resetFile(f) {
    if (f.pending) commit(f.pending);
    f.pending = null; f.offset = 0; f.head = ''; f.tail = '';
    dirty = true;
  }

  /** Remember the first bytes of the file and the bytes just before `offset`. */
  async function refreshSig(fh, f) {
    const want = Math.min(HEAD_BYTES, f.offset);
    if (want <= 0) { f.head = ''; f.tail = ''; return; }
    const h = Buffer.alloc(want);
    const t = Buffer.alloc(want);
    const a = await fh.read(h, 0, want, 0);
    const b = await fh.read(t, 0, want, f.offset - want);
    f.head = h.subarray(0, a.bytesRead).toString('base64');
    f.tail = t.subarray(0, b.bytesRead).toString('base64');
  }

  /** True when the bytes already read still match the remembered head and tail. */
  async function sigMatches(fh, f) {
    for (const [saved, at] of [[f.head, () => 0], [f.tail, (n) => f.offset - n]]) {
      if (!saved) continue; // legacy state without this part: re-baselined after the read
      const want = Buffer.from(saved, 'base64');
      const got = Buffer.alloc(want.length);
      const { bytesRead } = await fh.read(got, 0, want.length, at(want.length));
      if (bytesRead !== want.length || !got.equals(want)) return false;
    }
    return true;
  }

  async function readNew(p, f, st) {
    const fh = await fs.promises.open(p, 'r');
    try {
      const size = st.size;
      if (size < f.offset) resetFile(f);
      else if (f.offset > 0 && !(await sigMatches(fh, f))) resetFile(f);
      buf ||= Buffer.allocUnsafe(chunkSize); // one reusable buffer
      let pos = f.offset;
      let carry = Buffer.alloc(0);
      while (pos < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
        if (!bytesRead) break;
        pos += bytesRead;
        const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        const nl = data.lastIndexOf(10);
        if (nl === -1) { carry = Buffer.from(data); continue; }
        const text = data.subarray(0, nl).toString('utf8');
        carry = Buffer.from(data.subarray(nl + 1));
        for (const line of text.split('\n')) ingest(line, f);
        f.offset = pos - carry.length; // only ever advance to a line boundary
      }
      await refreshSig(fh, f);
      f.mtime = st.mtimeMs;
      dirty = true;
    } finally {
      await fh.close();
    }
  }

  async function scanOnce(getRoots) {
    if (running) return;
    running = true;
    try {
      const files = [];
      const visited = new Map();
      for (const root of getRoots()) walk(root, files, visited);
      dirCache = visited;
      if (files.length) { // forget logs that were deleted; their day totals stay
        const present = new Set(files);
        for (const p of Object.keys(state.files)) {
          if (present.has(p)) continue;
          if (state.files[p].pending) commit(state.files[p].pending);
          delete state.files[p];
          dirty = true;
        }
      }
      const work = [];
      for (const p of files) {
        let st;
        try { st = fs.statSync(p); } catch { continue; }
        const f = (state.files[p] ||= { offset: 0, pending: null });
        // unchanged size and mtime: nothing to read or verify
        if (st.size !== f.offset || (f.mtime !== undefined && st.mtimeMs !== f.mtime)) work.push([p, f, st]);
      }
      progress.scanning = work.length > 0;
      progress.done = 0;
      progress.total = work.length;
      let lastSave = Date.now();
      for (const [p, f, st] of work) {
        try { await readNew(p, f, st); } catch { /* file vanished or locked: try next round */ }
        progress.done++;
        progress.updatedAt = Date.now();
        if (Date.now() - lastSave > 20000) { save(); lastSave = Date.now(); }
        if (progress.done % 20 === 0) await new Promise((r) => setImmediate(r));
      }
      progress.scanning = false;
      progress.ready = true;
      progress.updatedAt = Date.now();
      dirty = true;
      if (saving) await saving;
      await save();
    } finally {
      running = false;
    }
  }

  /* -------------------------------- reporting -------------------------------- */

  const parseKey = (k) => {
    let v = parsedKeys.get(k);
    if (!v) { v = JSON.parse(k); parsedKeys.set(k, v); }
    return v;
  };

  function addUsage(a, k, c) {
    const [model, project, speed, tier, geo, pc] = parseKey(k);
    const price = priceOf(model);
    const cost = costOf(price, { in: c[0], out: c[1], cr: c[2], c5: c[3], c1: c[4], search: c[5], speed, tier, geo, prompt: promptOfClass(pc) });
    const tok = c[0] + c[1] + c[2] + c[3] + c[4];
    a.input += c[0]; a.output += c[1]; a.cacheRead += c[2]; a.cacheWrite += c[3] + c[4];
    a.cost += cost;
    if (!price) a.unpriced += tok;
    const m = (a.models[model] ||= { t: 0, c: 0 });
    m.t += tok; m.c += cost;
    const pr = (a.projects[project] ||= { t: 0, c: 0 });
    pr.t += tok; pr.c += cost;
  }

  const top = (map) => Object.entries(map)
    .map(([name, v]) => ({ name, tokens: v.t, cost: v.c }))
    .sort((a, b) => b.tokens - a.tokens);

  function getReport(days = 30, now = Date.now()) {
    const cutoff = cutoffKey(days, now);
    const aggs = new Map();
    const agg = (day) => {
      if (!aggs.has(day)) aggs.set(day, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0, models: {}, projects: {} });
      return aggs.get(day);
    };
    for (const [day, b] of Object.entries(state.days)) {
      if (day < cutoff) continue;
      for (const [k, c] of Object.entries(b.u || {})) addUsage(agg(day), k, c);
    }
    // each file's latest message is not committed yet: include it virtually, state stays untouched
    const counted = new Set();
    for (const f of Object.values(state.files)) {
      const r = f.pending;
      if (!r || r.day < cutoff) continue;
      if (r.key) {
        if (seen.has(r.key) || counted.has(r.key)) continue;
        counted.add(r.key);
      }
      addUsage(agg(r.day), variantKey(r), [r.in, r.out, r.cr, r.c5, r.c1, r.search || 0]);
    }
    const out = [...aggs.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, a]) => ({
        date,
        input: a.input, output: a.output, cacheRead: a.cacheRead, cacheWrite: a.cacheWrite,
        total: a.input + a.output + a.cacheRead + a.cacheWrite,
        cost: a.cost,
        unpriced: a.unpriced,
        models: top(a.models),
        projects: top(a.projects),
      }));
    return { ...progress, days: out };
  }

  return { state, progress, ingest, scanOnce, load, save, getReport };
}

/* ------------------------------- default scanner ------------------------------- */

const store = createTokenStore();

/** getRoots() returns the project folders to read (called every round, so added accounts are picked up). */
export function startTokenScanner({ getRoots, file }) {
  store.load(file);
  const round = () => { store.scanOnce(getRoots).catch(() => {}).finally(() => setTimeout(round, 60 * 1000).unref?.()); };
  round();
}

export function getTokenReport(days = 30, now = Date.now()) {
  return store.getReport(days, now);
}

/* ----------------------------------- mock ----------------------------------- */

export function mockTokenReport(days = 30) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = dayKey(d);
    const k = 0.4 + 0.6 * Math.abs(Math.sin(i * 1.7));
    const total = Math.round(k * 2.4e9);
    out.push({
      date, input: Math.round(total * 0.0005), output: Math.round(total * 0.004),
      cacheRead: Math.round(total * 0.93), cacheWrite: Math.round(total * 0.065),
      total, cost: k * 2400, unpriced: 0,
      models: [{ name: 'claude-opus-4-6', tokens: Math.round(total * 0.8), cost: k * 2100 }, { name: 'claude-sonnet-4-5', tokens: Math.round(total * 0.2), cost: k * 300 }],
      projects: [{ name: 'web-app', tokens: Math.round(total * 0.6), cost: k * 1500 }, { name: 'scripts', tokens: Math.round(total * 0.4), cost: k * 900 }],
    });
  }
  return { scanning: false, ready: true, done: 0, total: 0, updatedAt: Date.now(), days: out };
}

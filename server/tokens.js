/**
 * Per-day token and cost totals, read from the chat logs Claude Code keeps on this
 * computer (<config>/projects/**.jsonl). Same idea as the VS Code usage extension.
 *
 * - Incremental: remembers how far into each file it has read, so only new lines are parsed.
 * - Costs are ESTIMATES at public API prices, not what a subscription actually charges.
 * - Only covers this computer. Phone and other PCs never write logs here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PRICING_VERSION, priceFor, costOf } from './pricing.js';

/* ---------------------------------- state ---------------------------------- */

const state = { v: PRICING_VERSION, files: {}, days: {} };
const progress = { scanning: false, ready: false, done: 0, total: 0, updatedAt: 0 };
let stateFile = null;
let dirty = false;

function loadState(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.v === PRICING_VERSION) {
      state.files = j.files || {};
      state.days = j.days || {};
      progress.ready = true;
      progress.updatedAt = j.updatedAt || 0;
    }
  } catch { /* first run */ }
}

function saveState() {
  if (!stateFile || !dirty) return;
  try {
    const tmp = stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: progress.updatedAt }));
    fs.renameSync(tmp, stateFile);
    dirty = false;
  } catch { /* best effort */ }
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function projectName(cwd) {
  if (!cwd) return 'unknown';
  const p = String(cwd).replace(/\\/g, '/');
  const i = p.indexOf('/.claude/worktrees/');
  return (i > 0 ? p.slice(0, i) : p).split('/').filter(Boolean).pop() || 'unknown';
}

function bucket(day) {
  return (state.days[day] ||= { in: 0, out: 0, cr: 0, cw: 0, cost: 0, unpriced: 0, models: {}, projects: {} });
}

function commit(r) {
  const b = bucket(r.day);
  const tok = r.in + r.out + r.cr + r.c5 + r.c1;
  const cost = costOf(priceFor(r.model), r);
  b.in += r.in; b.out += r.out; b.cr += r.cr; b.cw += r.c5 + r.c1;
  b.cost += cost;
  if (!priceFor(r.model)) b.unpriced += tok;
  const m = (b.models[r.model] ||= { t: 0, c: 0 });
  m.t += tok; m.c += cost;
  const p = (b.projects[r.project] ||= { t: 0, c: 0 });
  p.t += tok; p.c += cost;
  dirty = true;
}

/* A message is logged once per content block, all with the same message id. Keep the
   last block's numbers (they are final) and commit when the id changes. */
function ingest(line, f) {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
  let j;
  try { j = JSON.parse(line); } catch { return; }
  const msg = j && j.message;
  if (!j || j.type !== 'assistant' || !msg || !msg.usage) return;
  const u = msg.usage;
  const day = dayKey(j.timestamp);
  if (!day) return;
  const cc = u.cache_creation || {};
  const c1 = Number(cc.ephemeral_1h_input_tokens) || 0;
  const c5 = cc.ephemeral_5m_input_tokens != null
    ? Number(cc.ephemeral_5m_input_tokens) || 0
    : Math.max(0, (Number(u.cache_creation_input_tokens) || 0) - c1);
  const rec = {
    id: msg.id || j.requestId || j.uuid || null,
    day,
    model: msg.model || j.requestedModel || 'unknown',
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
  if (f.pending && rec.id && f.pending.id === rec.id) { f.pending = rec; return; }
  if (f.pending) commit(f.pending);
  f.pending = rec;
}

/* --------------------------------- scanning --------------------------------- */

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

async function readNew(p, f, size) {
  const fh = await fs.promises.open(p, 'r');
  try {
    const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
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
  } finally {
    await fh.close();
  }
}

let running = false;

async function scanOnce(getRoots) {
  if (running) return;
  running = true;
  try {
    const files = [];
    for (const root of getRoots()) walk(root, files);
    const work = [];
    for (const p of files) {
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      const f = (state.files[p] ||= { offset: 0, pending: null });
      if (st.size < f.offset) { f.offset = st.size; f.pending = null; continue; } // rewritten file: don't double count
      if (st.size > f.offset) work.push([p, f, st.size]);
    }
    progress.scanning = work.length > 0;
    progress.done = 0;
    progress.total = work.length;
    let lastSave = Date.now();
    for (const [p, f, size] of work) {
      try { await readNew(p, f, size); } catch { /* file vanished or locked: try next round */ }
      progress.done++;
      progress.updatedAt = Date.now();
      if (Date.now() - lastSave > 20000) { saveState(); lastSave = Date.now(); }
      if (progress.done % 20 === 0) await new Promise((r) => setImmediate(r));
    }
    progress.scanning = false;
    progress.ready = true;
    progress.updatedAt = Date.now();
    dirty = true;
    saveState();
  } finally {
    running = false;
  }
}

/** getRoots() returns the project folders to read (called every round, so added accounts are picked up). */
export function startTokenScanner({ getRoots, file }) {
  stateFile = file;
  loadState(file);
  const round = () => { scanOnce(getRoots).catch(() => {}).finally(() => setTimeout(round, 60 * 1000).unref?.()); };
  round();
}

/* --------------------------------- reporting --------------------------------- */

function top(map) {
  return Object.entries(map)
    .map(([name, v]) => ({ name, tokens: v.t, cost: v.c }))
    .sort((a, b) => b.tokens - a.tokens);
}

export function getTokenReport(days = 30) {
  const cutoff = dayKey(Date.now() - (days - 1) * 864e5);
  const out = Object.entries(state.days)
    .filter(([d]) => d >= cutoff)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, b]) => ({
      date,
      input: b.in, output: b.out, cacheRead: b.cr, cacheWrite: b.cw,
      total: b.in + b.out + b.cr + b.cw,
      cost: b.cost,
      unpriced: b.unpriced,
      models: top(b.models),
      projects: top(b.projects),
    }));
  return { ...progress, days: out };
}

/* ----------------------------------- mock ----------------------------------- */

export function mockTokenReport(days = 30) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = dayKey(Date.now() - i * 864e5);
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

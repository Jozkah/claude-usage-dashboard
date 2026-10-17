/*
 * Claude usage dashboard: API + static file server.
 * ------------------------------------------------
 * - Reads the login of each Claude Code config folder (never sent to the browser).
 * - Asks Anthropic how much of each subscription limit is used.
 * - Keeps a small usage history so the dashboard can draw trends.
 * - Serves the built web app from ./dist (production) or runs next to Vite (dev).
 *
 * It never refreshes or changes a login. It uses an UNOFFICIAL, undocumented
 * endpoint (the same one Claude Code's /usage uses), so it can break.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTokenScanner, getTokenReport, mockTokenReport } from './tokens.js';
import { createUsageSnapshot } from './usage-snapshot.js';
import { shareLocalChats } from './chat-sharing.js';
import { findWindowsDesktopProfiles, syncDesktopSessionRecords } from './desktop-chat-sync.js';
import { syncDesktopLabels, desktopLabelFingerprint, desktopLabelSnapshot } from './desktop-label-sync.js';
import { chooseAutomaticLabelSource, chooseInitialLabelSource } from './desktop-auto-label-sync.js';
import { syncCodeSetup } from './code-setup-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const PORT = Number(process.env.PORT || 4777);
const HOST = process.env.HOST || '127.0.0.1';
const MOCK = process.env.MOCK === '1';
const DATA_DIR = process.env.DATA_DIR || os.homedir();
const ACCOUNTS_DIR = process.env.ACCOUNTS_DIR || '';
const ALLOW_ANY_HOST = process.env.ALLOW_ANY_HOST === '1';
const ALLOWED_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1',
  ...String(process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

const CONFIG_FILE = path.join(DATA_DIR, '.claude-usage-dashboard.json');
const HISTORY_FILE = path.join(DATA_DIR, '.claude-usage-history.json');
const USAGE_SNAPSHOT_FILE = path.join(DATA_DIR, '.claude-usage-latest.json');
const LABEL_BASELINE_FILE = path.join(DATA_DIR, '.claude-usage-label-baseline.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_MS = 55 * 1000;
const DESKTOP_SYNC_MS = 10 * 1000;
const DESKTOP_AUTO_SYNC = process.platform === 'win32' && !MOCK && !ACCOUNTS_DIR && process.env.DESKTOP_AUTO_SYNC !== '0';
let desktopSyncStatus = { enabled: DESKTOP_AUTO_SYNC, lastRun: null, lastError: null, toWork: 0, toPersonal: 0 };
let labelSyncStatus = { enabled: DESKTOP_AUTO_SYNC, lastRun: null, lastError: null, waiting: false };
let labelSyncBusy = false;

function desktopRunning() {
  const count = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '@(Get-Process -Name Claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*\\WindowsApps\\Claude_*" }).Count'],
  { encoding: 'utf8', timeout: 5000 }).trim());
  if (!Number.isFinite(count)) throw new Error('Could not check Claude Desktop processes.');
  return count > 0;
}

function readLabelBaseline() {
  try {
    const state = JSON.parse(fs.readFileSync(LABEL_BASELINE_FILE, 'utf8'));
    if (typeof state.personal === 'string' && typeof state.work === 'string') return state;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return null;
}

function labelFingerprints(profiles) {
  return { personal: desktopLabelFingerprint(profiles.personal), work: desktopLabelFingerprint(profiles.work) };
}

function saveLabelBaseline(profiles) {
  const temp = `${LABEL_BASELINE_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(labelFingerprints(profiles)));
    fs.renameSync(temp, LABEL_BASELINE_FILE);
  } finally { fs.rmSync(temp, { force: true }); }
}
const backoff = new Map(); // accountId -> { until, wait } after HTTP 429
const MIN_FORCE_MS = 10 * 1000;
const HISTORY_KEEP_MS = 8 * 864e5;

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function defaultAccounts() {
  if (ACCOUNTS_DIR && fs.existsSync(ACCOUNTS_DIR)) {
    const list = fs
      .readdirSync(ACCOUNTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => ({ id: slug(d.name), name: cap(d.name), configDir: path.join(ACCOUNTS_DIR, d.name) }));
    if (list.length) return list;
  }
  const home = os.homedir();
  const list = [{ id: 'personal', name: 'Personal', configDir: path.join(home, '.claude') }];
  const work = path.join(home, '.claude-work');
  if (fs.existsSync(work)) list.push({ id: 'work', name: 'Work', configDir: work });
  return list;
}

let mockAccounts = [
  { id: 'personal', name: 'Personal', configDir: '~/.claude' },
  { id: 'work', name: 'Work', configDir: '~/.claude-work' },
  { id: 'side-project', name: 'Side project', configDir: '~/.claude-side' },
  { id: 'research', name: 'Research', configDir: '~/.claude-research' },
  { id: 'studio', name: 'Studio', configDir: '~/.claude-studio' },
];

function loadAccounts() {
  if (MOCK) return mockAccounts;
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (Array.isArray(j.accounts)) return j.accounts;
  } catch { /* first run */ }
  return defaultAccounts();
}

function saveAccounts(accounts) {
  if (MOCK) { mockAccounts = accounts; return; }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ accounts }, null, 2));
}

/* ------------------------------------------------------------------ */
/* reading the login (never leaves this process)                       */
/* ------------------------------------------------------------------ */

function readCredentials(configDir) {
  const file = path.join(configDir, '.credentials.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.claudeAiOauth) return j.claudeAiOauth;
  } catch { /* try the keychain next */ }

  if (process.platform === 'darwin') {
    const isDefault = path.resolve(configDir) === path.join(os.homedir(), '.claude');
    const service = isDefault
      ? 'Claude Code-credentials'
      // Best effort: Claude Code suffixes the keychain item for custom config folders.
      : 'Claude Code-credentials-' + crypto.createHash('sha256').update(configDir).digest('hex').slice(0, 8);
    try {
      const out = execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const j = JSON.parse(out.trim());
      if (j && j.claudeAiOauth) return j.claudeAiOauth;
    } catch { /* not found */ }
  }
  return null;
}

function planLabel(c) {
  const t = String(c.subscriptionType || '').toLowerCase();
  if (!t) return null;
  let name = cap(t);
  const m = String(c.rateLimitTier || '').match(/(\d+)x/);
  if (t === 'max' && m) name += ' ' + m[1] + 'x';
  return name;
}

/* ------------------------------------------------------------------ */
/* querying usage                                                      */
/* ------------------------------------------------------------------ */

const LABELS = {
  five_hour: '5-hour session',
  seven_day: 'Weekly · all models',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  seven_day_oauth_apps: 'Weekly · OAuth apps',
  extra_usage: 'Extra usage',
};

function parseWindows(data) {
  const out = [];
  for (const [key, v] of Object.entries(data || {})) {
    // Anthropic also returns unnamed codename keys (e.g. iguana_necktie); skip anything we can't label.
    if (!LABELS[key]) continue;
    if (v && typeof v === 'object' && typeof v.utilization === 'number') {
      out.push({
        key,
        label: LABELS[key],
        used: Math.max(0, Math.min(100, Math.round(v.utilization * 10) / 10)),
        resetsAt: v.resets_at || null,
      });
    }
  }
  const rank = (k) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2);
  out.sort((a, b) => rank(a.key) - rank(b.key));
  return out;
}

/* Open Claude Code chats for one account. Claude Code writes <configDir>/sessions/<pid>.json
   for every running session and touches it while the chat is working. */
const WORKING_MS = 2 * 60 * 1000;

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function readSessions(configDir) {
  const dir = path.join(configDir, 'sessions');
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)); } catch { return []; }
  const inContainer = Boolean(ACCOUNTS_DIR); // pids from the host are not visible inside Docker
  const out = [];
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      const mtime = fs.statSync(file).mtimeMs;
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const alive = inContainer ? Date.now() - mtime < 10 * 60 * 1000 : pidAlive(j.pid);
      if (!alive) continue;
      out.push({
        id: String(j.sessionId || j.pid),
        name: String(j.name || '').slice(0, 80) || null,
        folder: String(j.cwd || '').split(/[\\/]/).filter(Boolean).pop() || null,
        where: String(j.entrypoint || '').replace(/^claude-/, '') || null,
        startedAt: Number(j.startedAt) || null,
        lastActiveAt: mtime,
        working: Date.now() - mtime < WORKING_MS,
      });
    } catch { /* unreadable file: ignore */ }
  }
  out.sort((a, b) => Number(b.working) - Number(a.working) || b.lastActiveAt - a.lastActiveAt);
  return out;
}

async function fetchStatus(acc) {
  const base = { id: acc.id, name: acc.name, configDir: acc.configDir, fetchedAt: Date.now() };
  const creds = readCredentials(expandHome(acc.configDir));
  if (!creds || !creds.accessToken) {
    return { ...base, status: 'no_login', message: 'No Claude login found in this folder. Start Claude Code with this config folder and log in once.' };
  }
  const plan = planLabel(creds);
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: 'Bearer ' + creds.accessToken,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-usage-dashboard/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ...base, plan, status: 'expired', message: 'Login expired. Open Claude Code with this account once and it will refresh itself.' };
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      const prev = backoff.get(acc.id);
      const wait = Number.isFinite(ra) && ra > 0
        ? Math.min(ra * 1000, 5 * 60 * 1000)
        : Math.min((prev ? prev.wait : 60 * 1000) * 2, 5 * 60 * 1000);
      backoff.set(acc.id, { until: Date.now() + wait, wait });
      return { ...base, plan, status: 'error', retryAt: Date.now() + wait, message: 'Anthropic is rate limiting the usage endpoint. Backing off; next try in ' + Math.ceil(wait / 60000) + ' min.' };
    }
    if (!res.ok) {
      return { ...base, plan, status: 'error', message: 'Usage endpoint answered HTTP ' + res.status + '.' };
    }
    const raw = await res.json();
    const windows = parseWindows(raw);
    if (!windows.length) {
      return { ...base, plan, status: 'error', message: 'Unexpected response format (Anthropic may have changed the endpoint). See raw data.', raw };
    }
    return { ...base, plan, status: 'ok', windows, raw };
  } catch (e) {
    return { ...base, plan, status: 'error', message: 'Could not reach Anthropic: ' + (e && e.message ? e.message : e) };
  }
}

/* ------------------------------------------------------------------ */
/* mock data (MOCK=1): a believable, self-consistent preview           */
/* ------------------------------------------------------------------ */

const MOCK_FACTOR = [0.72, 1.3, 0.35];
const MOCK_PLANS = ['Max 5x', 'Pro', 'Max 20x'];
const H5 = 5 * 3600e3;
const D7 = 7 * 864e5;

function mockValue(idx, key, t) {
  const seed = idx * 7 + 1;
  const f = MOCK_FACTOR[idx % MOCK_FACTOR.length];
  if (key === 'five_hour') {
    const phase = (t % H5) / H5;
    const v = phase * 100 * f * (0.55 + 0.3 * Math.sin(seed + Math.floor(t / H5))) + 5 * Math.sin(t / 9e5 + seed) * phase;
    return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  }
  const phase = (t % D7) / D7;
  const v = phase * 100 * f * 0.8 + 3 * Math.sin(t / 3e6 + seed) * phase;
  const scaled = key === 'seven_day' ? v : v * 0.55;
  return Math.max(0, Math.min(100, Math.round(scaled * 10) / 10));
}

function mockStatus(acc, idx) {
  const now = Date.now();
  const mk = (key, period) => ({
    key,
    label: LABELS[key],
    used: mockValue(idx, key, now),
    resetsAt: new Date((Math.floor(now / period) + 1) * period).toISOString(),
  });
  return {
    id: acc.id, name: acc.name, configDir: acc.configDir, fetchedAt: now,
    plan: MOCK_PLANS[idx % MOCK_PLANS.length], status: 'ok',
    windows: [mk('five_hour', H5), mk('seven_day', D7), mk('seven_day_opus', D7)],
    raw: { mock: true },
  };
}

/* ------------------------------------------------------------------ */
/* history                                                             */
/* ------------------------------------------------------------------ */

let history = {};
if (!MOCK) {
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { /* none yet */ }
}
let saveTimer = null;

function saveHistory() {
  if (MOCK) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history)); } catch { /* read-only is fine */ }
  }, 2000);
}

function recordHistory(id, windows) {
  if (MOCK) return;
  const now = Date.now();
  const acc = (history[id] ||= {});
  for (const w of windows) {
    const arr = (acc[w.key] ||= []);
    const last = arr[arr.length - 1];
    if (!last || now - last[0] >= 4 * 60e3 || (last[1] !== w.used && now - last[0] >= 50e3)) {
      arr.push([now, w.used]);
    }
    while (arr.length && arr[0][0] < now - HISTORY_KEEP_MS) arr.shift();
  }
  saveHistory();
}

const RANGES = { '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 864e5 };

function downsample(points, from, to, max = 240) {
  if (points.length <= max) return points;
  const size = (to - from) / max;
  const buckets = new Map();
  for (const p of points) {
    const i = Math.min(max - 1, Math.floor((p[0] - from) / size));
    const cur = buckets.get(i);
    if (!cur || p[1] > cur[1]) buckets.set(i, p);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

function getHistory(id, key, rangeKey) {
  const span = RANGES[rangeKey] || RANGES['24h'];
  const to = Date.now();
  const from = to - span;
  let points;
  if (MOCK) {
    const idx = Math.max(0, mockAccounts.findIndex((a) => a.id === id));
    const step = 10 * 60e3;
    points = [];
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) points.push([t, mockValue(idx, key, t)]);
  } else {
    points = ((history[id] || {})[key] || []).filter((p) => p[0] >= from);
  }
  return downsample(points, from, to);
}

/* ------------------------------------------------------------------ */
/* status cache                                                        */
/* ------------------------------------------------------------------ */

const cache = new Map();
const latestUsage = MOCK ? null : createUsageSnapshot(USAGE_SNAPSHOT_FILE);

async function getStatus(acc, index, force) {
  latestUsage?.seedFromHistory(acc, history[acc.id], LABELS);
  const hit = cache.get(acc.id);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && ((age < CACHE_MS && !force) || age < MIN_FORCE_MS)) return hit.value;
  // while backing off after a 429, never touch the endpoint (even on manual refresh)
  const bo = backoff.get(acc.id);
  if (hit && bo && Date.now() < bo.until && !(force && age > 30 * 1000)) return hit.value;

  let value = MOCK ? mockStatus(acc, index) : await fetchStatus(acc);
  if (value.status === 'ok') {
    backoff.delete(acc.id);
    recordHistory(acc.id, value.windows);
    latestUsage?.remember(acc, value);
  } else if (latestUsage) {
    value = latestUsage.fallback(acc, value);
  }
  cache.set(acc.id, { at: Date.now(), value });
  return value;
}

/* ------------------------------------------------------------------ */
/* http                                                                */
/* ------------------------------------------------------------------ */

function hostOk(req) {
  if (ALLOW_ANY_HOST) return true;
  const h = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return ALLOWED_HOSTS.has(h);
}

function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10000) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
};

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('API is running. Open http://localhost:5173 (npm run dev), or run "npm run build" first to serve the app from here.');
  }
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html'); // SPA fallback
  const ext = path.extname(file).toLowerCase();
  const immutable = file.includes(path.sep + 'assets' + path.sep);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) { res.writeHead(403); return res.end('Forbidden'); }
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/usage') {
      const force = url.searchParams.get('force') === '1';
      const accounts = loadAccounts();
      const statuses = await Promise.all(accounts.map((a, i) => getStatus(a, i, force)));
      // sessions are read fresh on every request (cheap, local), usage is cached
      const list = statuses.map((v, i) => ({ ...v, sessions: MOCK ? [] : readSessions(expandHome(accounts[i].configDir)) }));
      return sendJson(res, 200, { serverTime: Date.now(), mock: MOCK, accounts: list });
    }

    if (req.method === 'GET' && url.pathname === '/api/tokens') {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      return sendJson(res, 200, MOCK ? mockTokenReport(days) : getTokenReport(days));
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      const id = url.searchParams.get('id') || '';
      const key = url.searchParams.get('key') || 'five_hour';
      const range = url.searchParams.get('range') || '24h';
      return sendJson(res, 200, { points: getHistory(id, key, range) });
    }

    if (req.method === 'POST' && url.pathname === '/api/accounts') {
      if (!originOk(req) || !String(req.headers['content-type'] || '').includes('application/json')) {
        return sendJson(res, 403, { error: 'Forbidden' });
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const name = String(body.name || '').trim().slice(0, 40);
      const configDir = String(body.configDir || '').trim().slice(0, 300);
      if (!name || !configDir) return sendJson(res, 400, { error: 'Name and config folder are required.' });
      const accounts = [...loadAccounts()];
      let id = slug(name);
      while (accounts.some((a) => a.id === id)) id = slug(name) + '-' + crypto.randomBytes(2).toString('hex');
      accounts.push({ id, name, configDir });
      saveAccounts(accounts);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/share') {
      if (MOCK || ACCOUNTS_DIR) return sendJson(res, 400, { error: 'Local chat sharing requires a direct installation.' });
      if (!originOk(req) || !String(req.headers['content-type'] || '').includes('application/json')) {
        return sendJson(res, 403, { error: 'Forbidden' });
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const accounts = loadAccounts();
      const source = accounts.find((account) => account.id === body.sourceId);
      const target = accounts.find((account) => account.id === body.targetId);
      if (!source || !target || source.id === target.id) return sendJson(res, 400, { error: 'Choose two different accounts.' });
      try {
        const result = shareLocalChats(expandHome(source.configDir), expandHome(target.configDir));
        return sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/sync-desktop') {
      if (MOCK || ACCOUNTS_DIR) return sendJson(res, 400, { error: 'Desktop chat sync requires a direct installation.' });
      if (!originOk(req)) return sendJson(res, 403, { error: 'Forbidden' });
      const accounts = loadAccounts();
      const personal = accounts.find((account) => account.id === 'personal');
      const work = accounts.find((account) => account.id === 'work');
      if (!personal || !work) return sendJson(res, 400, { error: 'Personal and Work accounts are required.' });
      try {
        shareLocalChats(expandHome(personal.configDir), expandHome(work.configDir));
        const profiles = findWindowsDesktopProfiles();
        const result = syncDesktopSessionRecords(profiles.personal, profiles.work);
        desktopSyncStatus = { ...desktopSyncStatus, lastRun: Date.now(), lastError: null,
          toWork: desktopSyncStatus.toWork + result.toWork, toPersonal: desktopSyncStatus.toPersonal + result.toPersonal };
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/chats/sync-status') {
      return sendJson(res, 200, { ...desktopSyncStatus, labels: labelSyncStatus });
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/sync-labels') {
      if (MOCK || ACCOUNTS_DIR) return sendJson(res, 400, { error: 'Desktop label sync requires a direct installation.' });
      if (!originOk(req)) return sendJson(res, 403, { error: 'Forbidden' });
      try {
        if (desktopRunning()) return sendJson(res, 409, { error: 'Fully quit both Claude Desktop instances, including tray icons, then retry.' });
        if (labelSyncBusy) return sendJson(res, 409, { error: 'Desktop label sync is already running.' });
        labelSyncBusy = true;
        const profiles = findWindowsDesktopProfiles();
        const result = await syncDesktopLabels(profiles.personal, profiles.work);
        saveLabelBaseline(profiles);
        labelSyncStatus = { ...labelSyncStatus, lastRun: Date.now(), lastError: null };
        return sendJson(res, 200, result);
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      } finally { labelSyncBusy = false; }
    }

    if (req.method === 'POST' && url.pathname === '/api/code-setup/sync') {
      if (MOCK || ACCOUNTS_DIR) return sendJson(res, 400, { error: 'Local setup sync requires a direct installation.' });
      if (!originOk(req)) return sendJson(res, 403, { error: 'Forbidden' });
      const accounts = loadAccounts();
      const personal = accounts.find((account) => account.id === 'personal');
      const work = accounts.find((account) => account.id === 'work');
      if (!personal || !work) return sendJson(res, 400, { error: 'Personal and Work accounts are required.' });
      try {
        return sendJson(res, 200, syncCodeSetup(expandHome(personal.configDir), expandHome(work.configDir)));
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      }
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/accounts/')) {
      if (!originOk(req)) return sendJson(res, 403, { error: 'Forbidden' });
      const id = decodeURIComponent(url.pathname.slice('/api/accounts/'.length));
      saveAccounts(loadAccounts().filter((a) => a.id !== id));
      cache.delete(id);
      latestUsage?.forget(id);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    res.writeHead(405);
    res.end('Method not allowed');
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is the dashboard already running? Or set PORT=4778.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

if (!MOCK) {
  // Chat logs to read. Accounts that share a folder (junction) are only read once.
  startTokenScanner({
    file: path.join(DATA_DIR, '.claude-usage-tokens.json'),
    getRoots: () => {
      const seen = new Set();
      for (const a of loadAccounts()) {
        try { seen.add(fs.realpathSync(path.join(expandHome(a.configDir), 'projects'))); } catch { /* no logs yet */ }
      }
      return [...seen];
    },
  });
}

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Claude usage API listening on ${url}${MOCK ? '  (MOCK DATA)' : ''}`);
  if (ALLOW_ANY_HOST) console.log('WARNING: any host name is accepted. Only do this on a network you trust.');
  if (process.env.NO_OPEN !== '1' && fs.existsSync(DIST)) {
    try {
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    } catch { /* opening the browser is optional */ }
  }
});

if (DESKTOP_AUTO_SYNC) {
  const syncNewDesktopRecords = () => {
    try {
      const accounts = loadAccounts();
      if (!accounts.some((account) => account.id === 'personal') || !accounts.some((account) => account.id === 'work')) return;
      const profiles = findWindowsDesktopProfiles();
      const result = syncDesktopSessionRecords(profiles.personal, profiles.work,
        { minAgeMs: 2000, inspectConflicts: false });
      desktopSyncStatus = { enabled: true, lastRun: Date.now(), lastError: null,
        toWork: desktopSyncStatus.toWork + result.toWork, toPersonal: desktopSyncStatus.toPersonal + result.toPersonal };
      if (result.toWork || result.toPersonal) console.log(`Desktop chats: ${result.toWork} to Work, ${result.toPersonal} to Personal`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== desktopSyncStatus.lastError) console.warn(`Desktop chat sync: ${message}`);
      desktopSyncStatus = { ...desktopSyncStatus, lastError: message };
    }
  };
  setTimeout(syncNewDesktopRecords, 1000).unref();
  setInterval(syncNewDesktopRecords, DESKTOP_SYNC_MS).unref();

  let closedChecks = 0;
  let syncedDuringClosure = false;
  const syncClosedDesktopLabels = async () => {
    if (labelSyncBusy) return;
    try {
      if (desktopRunning()) {
        closedChecks = 0;
        syncedDuringClosure = false;
        labelSyncStatus = { ...labelSyncStatus, waiting: true };
        return;
      }
      if (++closedChecks < 2 || syncedDuringClosure) return;
      labelSyncBusy = true;
      const profiles = findWindowsDesktopProfiles();
      const current = labelFingerprints(profiles);
      const baseline = readLabelBaseline();
      const source = baseline ? chooseAutomaticLabelSource(current, baseline)
        : chooseInitialLabelSource(desktopLabelSnapshot(profiles.personal), desktopLabelSnapshot(profiles.work));
      if (!source) throw new Error('Both Desktop profiles have different group changes. Use manual group sync after reviewing them.');
      const result = await syncDesktopLabels(profiles.personal, profiles.work, { source });
      saveLabelBaseline(profiles);
      labelSyncStatus = { enabled: true, lastRun: Date.now(), lastError: null, waiting: false };
      syncedDuringClosure = true;
      if (result.titles || result.groups) console.log(`Desktop labels: ${result.titles} titles, ${result.groups} groups, ${result.assignments} assignments`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== labelSyncStatus.lastError) console.warn(`Desktop label sync: ${message}`);
      labelSyncStatus = { ...labelSyncStatus, lastError: message, waiting: false };
      syncedDuringClosure = true;
    } finally { labelSyncBusy = false; }
  };
  setInterval(syncClosedDesktopLabels, 30_000).unref();
}

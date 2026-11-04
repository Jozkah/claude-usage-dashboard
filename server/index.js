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
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTokenScanner, getTokenReport, mockTokenReport } from './tokens.js';
import { createUsageSnapshot } from './usage-snapshot.js';
import { visibleUsageWindows } from './plan-limits.js';
import { nextUsagePollAt } from './usage-schedule.js';
import { activeSessionState } from './session-activity.js';
import { shareLocalChats } from './chat-sharing.js';
import { findWindowsDesktopProfiles, syncDesktopSessionRecordsMany, repairEmptyDesktopSessionRecords, repairStaleDesktopSessionRecords, alignDesktopSessionBranches, reconcileWorkSessionRecords } from './desktop-chat-sync.js';
import { syncMergedDesktopLabelsMany, desktopLabelSyncStatus } from './desktop-label-sync.js';
import { parseDesktopProcessState } from './desktop-process-state.js';
import { syncCodeSetup } from './code-setup-sync.js';
import { HttpError, sendJson, parseJsonBody, decodeId, resolveStaticPath, streamFile, writeFileAtomic, createInflight,
  parseAllowedHosts, hostAllowed, guardMutation, SECURITY_HEADERS } from './http-utils.js';
import { slug, expandHome, normalizeAccounts, uniqueIds, validateConfigDir, sanitizeHistory, historyPoints,
  credentialsExpired } from './account-utils.js';
import { createSessionReader } from './sessions.js';
import { readCredentials } from './credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const PORT = Number(process.env.PORT || 4777);
const HOST = process.env.HOST || '127.0.0.1';
const MOCK = process.env.MOCK === '1';
const DATA_DIR = process.env.DATA_DIR || os.homedir();
const ACCOUNTS_DIR = process.env.ACCOUNTS_DIR || '';
const ALLOW_ANY_HOST = process.env.ALLOW_ANY_HOST === '1';
const ALLOWED_HOSTS = parseAllowedHosts(process.env.ALLOWED_HOSTS);
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';

const CONFIG_FILE = path.join(DATA_DIR, '.claude-usage-dashboard.json');
const HISTORY_FILE = path.join(DATA_DIR, '.claude-usage-history.json');
const USAGE_SNAPSHOT_FILE = path.join(DATA_DIR, '.claude-usage-latest.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_MS = 55 * 1000;
const DESKTOP_SYNC_MS = 10 * 1000;
const DESKTOP_AUTO_SYNC = process.platform === 'win32' && !MOCK && !ACCOUNTS_DIR && process.env.DESKTOP_AUTO_SYNC !== '0';
let desktopSyncStatus = { enabled: DESKTOP_AUTO_SYNC, lastRun: null, lastError: null, copied: {}, deleted: 0, repaired: 0, branchesAligned: 0 };
let labelSyncStatus = { enabled: DESKTOP_AUTO_SYNC, lastRun: null, lastError: null, waiting: false, skippedScopes: [] };
let labelSyncBusy = false;

function desktopProfileState(profiles = findWindowsDesktopProfiles()) {
  const script = "@(Get-CimInstance Win32_Process -Filter \"Name = 'Claude.exe'\" | " +
    "Where-Object { $_.CommandLine -notmatch '--type=' } | " +
    'Select-Object ExecutablePath,CommandLine) | ConvertTo-Json -Compress';
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 10000, windowsHide: true }, (error, stdout) => {
        if (error) return reject(error);
        try {
          const output = String(stdout).trim();
          const processes = output ? JSON.parse(output) : [];
          resolve(parseDesktopProcessState(profiles, Array.isArray(processes) ? processes : [processes]));
        } catch (e) { reject(e); }
      });
  });
}

async function desktopRunning() {
  const state = await desktopProfileState();
  return Object.values(state).some(Boolean);
}

const loginStartedAt = new Map(); // accountId -> ms of last sign-in launch
const backoff = new Map(); // accountId -> { until, wait } after HTTP 429
const MIN_FORCE_MS = 10 * 1000;
const HISTORY_KEEP_MS = 8 * 864e5;
const UPSTREAM_TIMEOUT_MS = 20 * 1000;

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function defaultAccounts() {
  if (ACCOUNTS_DIR && fs.existsSync(ACCOUNTS_DIR)) {
    const list = fs
      .readdirSync(ACCOUNTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => ({ id: slug(d.name), name: cap(d.name), configDir: path.join(ACCOUNTS_DIR, d.name) }));
    if (list.length) return uniqueIds(list);
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
  let text;
  try { text = fs.readFileSync(CONFIG_FILE, 'utf8'); } catch (e) {
    if (e && e.code !== 'ENOENT') console.warn('Could not read ' + CONFIG_FILE + ': ' + e.message);
    return defaultAccounts(); // first run
  }
  try {
    const j = JSON.parse(text);
    if (j && Array.isArray(j.accounts)) {
      const { accounts, dropped } = normalizeAccounts(j.accounts);
      if (dropped.length) warnOnce('accounts-dropped', 'Ignoring ' + dropped.length + ' invalid or duplicate account entr' + (dropped.length === 1 ? 'y' : 'ies') + ' in ' + CONFIG_FILE);
      return accounts;
    }
  } catch { /* corrupt: keep a copy below */ }
  try { fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bad'); } catch { /* best effort */ }
  warnOnce('accounts-corrupt', CONFIG_FILE + ' is unreadable; using default accounts. A copy was kept as .bad.');
  return defaultAccounts();
}

const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function saveAccounts(accounts) {
  if (MOCK) { mockAccounts = accounts; return; }
  writeFileAtomic(CONFIG_FILE, JSON.stringify({ accounts }, null, 2));
}

/* ------------------------------------------------------------------ */
/* reading the login (never leaves this process)                       */
/* ------------------------------------------------------------------ */

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

/* Open Claude Code chats per account: async, cached 3 s per config folder, files older than 24 h count as dead. */
const readSessions = createSessionReader({ inContainer: Boolean(ACCOUNTS_DIR) }); // host pids are not visible in Docker

async function safeSessions(acc) {
  try { return await readSessions(expandHome(acc.configDir)); } catch { return []; }
}

async function fetchStatus(acc) {
  const base = { id: acc.id, name: acc.name, configDir: acc.configDir, fetchedAt: Date.now() };
  let creds;
  try { creds = await readCredentials(expandHome(acc.configDir)); } catch (e) {
    return { ...base, status: 'error', message: 'Could not read the login: ' + (e && e.message ? e.message : e) };
  }
  if (!creds || !creds.accessToken) {
    return { ...base, status: 'no_login', message: 'No Claude Code login found in this config folder. Claude Desktop can be signed in separately.' };
  }
  const plan = planLabel(creds);
  if (credentialsExpired(creds, Date.now())) {
    return { ...base, plan, status: 'expired', message: 'Login expired. Open Claude Code with this account once and it will refresh itself.' };
  }
  // One timeout covers connecting AND reading the body.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: 'Bearer ' + creds.accessToken,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-usage-dashboard/1.0',
      },
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { ...base, plan, status: 'expired', message: 'Login expired. Open Claude Code with this account once and it will refresh itself.' };
    }
    if (res.status === 403) {
      return { ...base, plan, status: 'error', message: 'Usage endpoint refused the login (HTTP 403). Re-login may not help; the login may lack access or be blocked.' };
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      const prev = backoff.get(acc.id);
      const wait = Number.isFinite(ra) && ra > 0
        ? Math.min(ra * 1000, 60 * 60 * 1000)
        : Math.min((prev ? prev.wait : 60 * 1000) * 2, 60 * 60 * 1000);
      backoff.set(acc.id, { until: Date.now() + wait, wait });
      return { ...base, plan, status: 'error', retryAt: Date.now() + wait, message: 'Anthropic is rate limiting usage. Next try in ' + Math.ceil(wait / 60000) + ' min.' };
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 120); } catch { /* no body */ }
      return { ...base, plan, status: 'error', message: 'Usage endpoint answered HTTP ' + res.status + '.' + (detail ? ' ' + detail : '') };
    }
    const raw = await res.json();
    const windows = parseWindows(raw);
    if (!windows.length) {
      return { ...base, plan, status: 'error', message: 'Unexpected response format (Anthropic may have changed the endpoint). See raw data.', raw };
    }
    return { ...base, plan, status: 'ok', windows, raw };
  } catch (e) {
    const msg = controller.signal.aborted ? 'request timed out after ' + UPSTREAM_TIMEOUT_MS / 1000 + ' s' : (e && e.message ? e.message : e);
    return { ...base, plan, status: 'error', message: 'Could not reach Anthropic: ' + msg };
  } finally { clearTimeout(timer); }
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

let history = Object.create(null);
if (!MOCK) {
  try { history = sanitizeHistory(JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))); } catch { /* none yet */ }
}
let saveTimer = null;

function writeHistoryNow() {
  try { writeFileAtomic(HISTORY_FILE, JSON.stringify(history)); } catch (e) {
    warnOnce('history-write', 'Could not save usage history (' + e.message + '). Further failures are not logged.');
  }
}

function saveHistory() {
  if (MOCK) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeHistoryNow(); }, 2000);
  saveTimer.unref();
}

function flushHistory() {
  if (MOCK || !saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeHistoryNow();
}

function recordHistory(id, windows) {
  if (MOCK) return;
  const now = Date.now();
  const acc = (history[id] ||= Object.create(null));
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

function getHistory(id, key, rangeKey, since = null) {
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
    points = historyPoints(history, id, key).filter((p) => p[0] >= from);
  }
  if (since != null) points = points.filter((p) => p[0] > since);
  return downsample(points, from, to);
}

/* ------------------------------------------------------------------ */
/* status cache                                                        */
/* ------------------------------------------------------------------ */

const cache = new Map();
const latestUsage = MOCK ? null : createUsageSnapshot(USAGE_SNAPSHOT_FILE);

const inflight = createInflight();
const lastLivePoll = new Map(); // accountId -> ms of last upstream attempt
const PAUSED_RECHECK_MS = 15 * 60 * 1000; // slow poll while a window sits at 100%

function getStatus(acc, index, force) {
  return inflight(acc.id, () => loadStatus(acc, index, force));
}

async function loadStatus(acc, index, force) {
  latestUsage?.seedFromHistory(acc, history[acc.id], LABELS, cache.get(acc.id)?.value?.plan);
  const hit = cache.get(acc.id);
  const age = hit ? Date.now() - hit.at : Infinity;
  const previous = hit?.value ?? latestUsage?.peek(acc);
  // extra_usage is not a reset-bound limit, so it never pauses polling.
  const pausable = previous?.windows
    ? { ...previous, windows: previous.windows.filter((w) => w.key !== 'extra_usage') } : previous;
  const nextPollAt = previous?.nextPollAt || nextUsagePollAt(pausable, Date.now());
  const recheckDue = Date.now() - (lastLivePoll.get(acc.id) || 0) >= PAUSED_RECHECK_MS;
  if (previous && nextPollAt > Date.now() && !force && !recheckDue) {
    latestUsage?.deferUntil(acc, nextPollAt);
    const paused = previous.stale
      ? { ...previous, nextPollAt, staleMessage: 'Next usage check at estimated reset.' }
      : { ...previous, nextPollAt };
    if (hit) hit.value = paused;
    return paused;
  }
  if (hit && ((age < CACHE_MS && !force) || age < MIN_FORCE_MS)) return hit.value;
  // Respect rate limits even on manual refresh.
  const bo = backoff.get(acc.id);
  if (bo && Date.now() < bo.until && previous) return previous;

  lastLivePoll.set(acc.id, Date.now());
  /** @type {any} */
  let value;
  try { value = MOCK ? mockStatus(acc, index) : await fetchStatus(acc); } catch (e) {
    value = { id: acc.id, name: acc.name, configDir: acc.configDir, fetchedAt: Date.now(), status: 'error',
      message: 'Could not check usage: ' + (e && e.message ? e.message : e) };
  }
  if (value.windows) value = { ...value, windows: visibleUsageWindows(value.plan, value.windows) };
  if (value.status === 'ok') {
    backoff.delete(acc.id);
    recordHistory(acc.id, value.windows);
    latestUsage?.remember(acc, value);
  } else if (latestUsage) {
    value = latestUsage.fallback(acc, value);
    if (value.windows) value = { ...value, windows: visibleUsageWindows(value.plan, value.windows) };
  }
  cache.set(acc.id, { at: Date.now(), value });
  return value;
}

/* ------------------------------------------------------------------ */
/* http                                                                */
/* ------------------------------------------------------------------ */

function hostOk(req) {
  return ALLOW_ANY_HOST || hostAllowed(req.headers.host, ALLOWED_HOSTS);
}

/* Mutating routes: Sec-Fetch-Site same-origin/none, Origin must match Host, JSON content type when a body is
   present, plus DASHBOARD_TOKEN when configured (header x-dashboard-token, Authorization: Bearer, or the cookie
   set by opening /?token=...). With ALLOW_ANY_HOST the host check is off, so a token is required.
   Returns true when blocked (response already sent). */
function blocked(req, res) {
  const denied = guardMutation(req.headers, { token: DASHBOARD_TOKEN, allowAnyHost: ALLOW_ANY_HOST });
  if (!denied) return false;
  sendJson(res, denied.status, { error: denied.error });
  return true;
}

const pad2 = (n) => String(n).padStart(2, '0');
const localDayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json',
};

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    return res.end('API is running. Open http://localhost:5173 (npm run dev), or run "npm run build" first to serve the app from here.');
  }
  const found = resolveStaticPath(DIST, pathname);
  if (found.status !== 200) {
    res.writeHead(found.status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    return res.end(found.status === 400 ? 'Bad request' : found.status === 403 ? 'Forbidden' : 'Not found');
  }
  const file = found.file;
  const ext = path.extname(file).toLowerCase();
  const immutable = file.includes(path.sep + 'assets' + path.sep);
  streamFile(res, file, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
  }, req.method);
}

async function handler(req, res) {
  try {
    if (!hostOk(req)) {
      warnOnce('host:' + req.headers.host, 'Rejected Host header "' + req.headers.host + '". Add it to ALLOWED_HOSTS if intended (ports are ignored, case-insensitive).');
      res.writeHead(403, SECURITY_HEADERS); return res.end('Forbidden');
    }
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()), mock: MOCK });
    }

    if (req.method === 'GET' && url.pathname === '/api/usage') {
      const force = url.searchParams.get('force') === '1';
      const accounts = loadAccounts();
      const statuses = await Promise.all(accounts.map((a, i) => getStatus(a, i, force)));
      // sessions: async, cached 3 s per config folder; usage is cached longer
      const sessionLists = MOCK ? [] : await Promise.all(accounts.map(safeSessions));
      const list = statuses.map((v, i) => ({ ...v, name: accounts[i].name, configDir: accounts[i].configDir,
        sessions: MOCK ? [] : sessionLists[i] }));
      return sendJson(res, 200, { serverTime: Date.now(), mock: MOCK, accounts: list });
    }

    if (req.method === 'GET' && url.pathname === '/api/tokens') {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      const report = MOCK ? mockTokenReport(days) : getTokenReport(days);
      return sendJson(res, 200, { ...report, today: localDayKey(), timeZone: localTimeZone() });
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      const id = url.searchParams.get('id') || '';
      const key = url.searchParams.get('key') || 'five_hour';
      const range = url.searchParams.get('range') || '24h';
      if (!Object.hasOwn(LABELS, key)) return sendJson(res, 400, { error: 'Unknown usage key.' });
      if (!Object.hasOwn(RANGES, range)) return sendJson(res, 400, { error: 'Unknown range.' });
      const sinceRaw = url.searchParams.get('since');
      let since = null;
      if (sinceRaw !== null) {
        since = /^\d{1,16}$/.test(sinceRaw) ? Number(sinceRaw) : NaN;
        if (!Number.isSafeInteger(since)) return sendJson(res, 400, { error: 'since must be an epoch in milliseconds.' });
      }
      return sendJson(res, 200, { points: getHistory(id, key, range, since) });
    }

    if (req.method === 'POST' && url.pathname === '/api/accounts') {
      if (blocked(req, res)) return;
      const body = await parseJsonBody(req);
      const name = String(body.name || '').trim().slice(0, 40);
      const rawDir = String(body.configDir || '').trim().slice(0, 300);
      if (!name || !rawDir) return sendJson(res, 400, { error: 'Name and config folder are required.' });
      const accounts = [...loadAccounts()];
      let configDir = rawDir;
      if (!MOCK) {
        try { configDir = validateConfigDir(rawDir, accounts.map((a) => a.configDir)); } catch (error) {
          return sendJson(res, 400, { error: error.message });
        }
      }
      let id = slug(name);
      while (accounts.some((a) => a.id === id)) id = slug(name) + '-' + crypto.randomBytes(2).toString('hex');
      accounts.push({ id, name, configDir });
      saveAccounts(accounts);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && /^\/api\/accounts\/[^/]+\/login$/.test(url.pathname)) {
      if (blocked(req, res)) return;
      if (MOCK || ACCOUNTS_DIR || process.platform !== 'win32') {
        return sendJson(res, 400, { error: 'Sign-in launcher requires a direct Windows installation.' });
      }
      const id = decodeId(url.pathname.split('/')[3]);
      const account = loadAccounts().find((candidate) => candidate.id === id);
      if (!account) return sendJson(res, 404, { error: 'Account not found.' });
      const configDir = expandHome(account.configDir);
      if (!fs.existsSync(configDir)) return sendJson(res, 400, { error: 'Config folder does not exist.' });
      if (Date.now() - (loginStartedAt.get(id) || 0) < 15000) {
        return sendJson(res, 409, { error: 'A sign-in window was just opened for this account.' });
      }
      loginStartedAt.set(id, Date.now());
      try {
        const child = spawn('cmd.exe', ['/k', 'claude auth login'], {
          env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
          detached: true, stdio: 'ignore', windowsHide: false,
        });
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });
        child.on('error', (error) => console.error('Sign-in process error:', error));
        child.unref();
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        loginStartedAt.delete(id);
        console.error('Could not start Claude sign-in:', error);
        return sendJson(res, 500, { error: 'Could not start Claude sign-in: ' + error.message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/share') {
      if (MOCK || ACCOUNTS_DIR) return sendJson(res, 400, { error: 'Local chat sharing requires a direct installation.' });
      if (blocked(req, res)) return;
      const body = await parseJsonBody(req);
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
      if (blocked(req, res)) return;
      try {
        const profiles = findWindowsDesktopProfiles();
        const result = syncDesktopSessionRecordsMany(profiles);
        const copied = { ...desktopSyncStatus.copied };
        for (const [id, count] of Object.entries(result.copied)) copied[id] = (copied[id] || 0) + count;
        desktopSyncStatus = { ...desktopSyncStatus, lastRun: Date.now(), lastError: null,
          copied, deleted: desktopSyncStatus.deleted + (result.deleted || 0) };
        return sendJson(res, 200, { ...result, deleted: result.deleted || 0 });
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/chats/sync-status') {
      return sendJson(res, 200, { ...desktopSyncStatus, labels: { ...labelSyncStatus, ...(await desktopLabelSyncStatus()) } });
    }

    if (req.method === 'POST' && url.pathname === '/api/chats/sync-labels') {
      if (MOCK || ACCOUNTS_DIR) return sendJson(res, 400, { error: 'Desktop label sync requires a direct installation.' });
      if (blocked(req, res)) return;
      if (labelSyncBusy) return sendJson(res, 409, { error: 'Desktop label sync is already running.' });
      labelSyncBusy = true;
      try {
        if (await desktopRunning()) return sendJson(res, 409, { error: 'Fully quit every Claude Desktop instance, including tray icons, then retry.' });
        const profiles = findWindowsDesktopProfiles();
        const result = await syncMergedDesktopLabelsMany(profiles);
        labelSyncStatus = { ...labelSyncStatus, lastRun: Date.now(), lastError: null, skippedScopes: result.skippedScopes || [] };
        return sendJson(res, 200, { ...result, skippedScopes: result.skippedScopes || [] });
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      } finally { labelSyncBusy = false; }
    }

    if (req.method === 'POST' && url.pathname === '/api/code-setup/sync') {
      if (MOCK || ACCOUNTS_DIR) return sendJson(res, 400, { error: 'Local setup sync requires a direct installation.' });
      if (blocked(req, res)) return;
      const body = await parseJsonBody(req); // optional: { sourceId, targetId }; empty body keeps Personal -> Work
      const custom = body.sourceId !== undefined || body.targetId !== undefined;
      if (custom && (typeof body.sourceId !== 'string' || typeof body.targetId !== 'string' || body.sourceId === body.targetId)) {
        return sendJson(res, 400, { error: 'Choose two different accounts.' });
      }
      const accounts = loadAccounts();
      const personal = accounts.find((account) => account.id === (custom ? body.sourceId : 'personal'));
      const work = accounts.find((account) => account.id === (custom ? body.targetId : 'work'));
      if (!personal || !work) {
        return sendJson(res, 400, { error: custom ? 'Unknown source or target account.' : 'Personal and Work accounts are required.' });
      }
      try {
        return sendJson(res, 200, syncCodeSetup(expandHome(personal.configDir), expandHome(work.configDir)));
      } catch (error) {
        return sendJson(res, 409, { error: error.message });
      }
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/accounts/')) {
      if (blocked(req, res)) return;
      const id = decodeId(url.pathname.slice('/api/accounts/'.length));
      const before = loadAccounts();
      if (!before.some((a) => a.id === id)) return sendJson(res, 404, { error: 'Account not found.' });
      saveAccounts(before.filter((a) => a.id !== id));
      cache.delete(id);
      backoff.delete(id);
      lastLivePoll.delete(id);
      if (Object.hasOwn(history, id)) { delete history[id]; saveHistory(); }
      latestUsage?.forget(id);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'Not found' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (DASHBOARD_TOKEN && url.searchParams.get('token') === DASHBOARD_TOKEN) {
        res.setHeader('Set-Cookie', 'dashboard_token=' + DASHBOARD_TOKEN + '; Path=/; HttpOnly; SameSite=Strict');
      }
      return serveStatic(req, res, url.pathname);
    }
    res.writeHead(405, SECURITY_HEADERS);
    res.end('Method not allowed');
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error('Request failed:', req.method, req.url, e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error.' });
    else res.destroy();
  }
}

export function createServer() {
  return http.createServer(handler);
}

function startTokenScan() {
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

function startDesktopSync() {
  const timers = [];
  const syncNewDesktopRecords = () => {
    try {
      const profiles = findWindowsDesktopProfiles();
      const result = syncDesktopSessionRecordsMany(profiles,
        { minAgeMs: 2000, inspectConflicts: false });
      const copied = { ...desktopSyncStatus.copied };
      for (const [id, count] of Object.entries(result.copied)) copied[id] = (copied[id] || 0) + count;
      desktopSyncStatus = { ...desktopSyncStatus, enabled: true, lastRun: Date.now(), lastError: null,
        copied };
      if (Object.values(result.copied).some(Boolean)) console.log(`Desktop chats: ${JSON.stringify(result.copied)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== desktopSyncStatus.lastError) console.warn(`Desktop chat sync: ${message}`);
      desktopSyncStatus = { ...desktopSyncStatus, lastError: message };
    }
  };
  timers.push(setTimeout(syncNewDesktopRecords, 1000), setInterval(syncNewDesktopRecords, DESKTOP_SYNC_MS));

  let closedChecks = 0;
  const profileClosedChecks = {};
  let syncedDuringClosure = false;
  const syncClosedDesktopLabels = async () => {
    if (labelSyncBusy) return;
    try {
      const profiles = findWindowsDesktopProfiles();
      const ids = Object.keys(profiles);
      const running = await desktopProfileState(profiles);
      for (const profile of ids) {
        if (running[profile]) {
          profileClosedChecks[profile] = 0;
        } else profileClosedChecks[profile] = (profileClosedChecks[profile] || 0) + 1;
      }
      for (const profile of ids) {
        if (profileClosedChecks[profile] < 2) continue;
        let repaired = 0;
        let staleRepaired = 0;
        for (const source of ids.filter((id) => id !== profile)) {
          repaired += repairEmptyDesktopSessionRecords(profiles[source], profiles[profile], { targetProfile: 'work' });
          staleRepaired += repairStaleDesktopSessionRecords(profiles[source], profiles[profile], { targetProfile: 'work' });
        }
        const reconciled = profile !== 'personal'
          ? reconcileWorkSessionRecords(profiles.personal, profiles[profile]) : 0;
        const branchesAligned = alignDesktopSessionBranches(profiles[profile]);
        desktopSyncStatus = { ...desktopSyncStatus, repaired: desktopSyncStatus.repaired + repaired + staleRepaired,
          branchesAligned: desktopSyncStatus.branchesAligned + branchesAligned };
        if (repaired || staleRepaired || reconciled || branchesAligned) console.log(`Desktop ${profile}: repaired ${repaired} empty chats, ${staleRepaired} stale chats, reconciled ${reconciled} chats, aligned ${branchesAligned} branches`);
      }
      const open = ids.filter((id) => running[id]);
      if (open.length) {
        closedChecks = 0;
        syncedDuringClosure = false;
        const targets = ids.filter((id) => !running[id] && profileClosedChecks[id] >= 2);
        if (targets.length) {
          labelSyncBusy = true;
          const result = await syncMergedDesktopLabelsMany(profiles, { targetIds: targets });
          labelSyncStatus = { enabled: true, lastRun: Date.now(), lastError: null, waiting: true, skippedScopes: result.skippedScopes || [] };
          if (result.updated) console.log(`Desktop labels: synced ${targets.join(', ')}`);
        } else labelSyncStatus = { ...labelSyncStatus, waiting: true };
        return;
      }
      if (++closedChecks < 2 || syncedDuringClosure) return;
      labelSyncBusy = true;
      const result = await syncMergedDesktopLabelsMany(profiles);
      labelSyncStatus = { enabled: true, lastRun: Date.now(), lastError: null, waiting: false, skippedScopes: result.skippedScopes || [] };
      if (!Object.values(await desktopProfileState(profiles)).some(Boolean)) syncedDuringClosure = true;
      if (result.conflicts?.length) console.warn(`Desktop labels: ${result.conflicts.length} assignment conflict(s); first profile wins`);
      if (result.titles || result.groups) console.log(`Desktop labels: ${result.titles} titles, ${result.groups} groups, ${result.assignments} assignments`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== labelSyncStatus.lastError) console.warn(`Desktop label sync: ${message}`);
      labelSyncStatus = { ...labelSyncStatus, lastError: message, waiting: false };
    } finally { labelSyncBusy = false; }
  };
  timers.push(setInterval(syncClosedDesktopLabels, 30_000));
  for (const t of timers) t.unref();
  return () => { for (const t of timers) { clearTimeout(t); clearInterval(t); } };
}

/**
 * Start listening. Options default to the environment; tests pass port 0 and turn side effects off.
 * Resolves with the listening http.Server (its close() also stops the desktop sync timers).
 */
export function start({ port = PORT, host = HOST, scanner = !MOCK, desktopSync = DESKTOP_AUTO_SYNC,
  openBrowser = process.env.NO_OPEN !== '1' } = {}) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const actual = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
      const url = `http://localhost:${actual}`;
      console.log(`Claude usage API listening on ${url}${MOCK ? '  (MOCK DATA)' : ''}`);
      if (ALLOW_ANY_HOST) console.log('WARNING: any host name is accepted. Only do this on a network you trust.' +
        (DASHBOARD_TOKEN ? ' Changes need DASHBOARD_TOKEN (open /?token=... once to set the cookie, or send X-Dashboard-Token / Authorization: Bearer).'
          : ' Changes (add/delete account, sync, sign-in) are blocked until DASHBOARD_TOKEN is set.'));
      if (scanner) startTokenScan();
      if (desktopSync) {
        const stop = startDesktopSync();
        server.once('close', stop);
      }
      if (openBrowser && fs.existsSync(DIST)) {
        try {
          const cmd = /** @type {[string, string[]]} */ (process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
            : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]);
          spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
        } catch { /* opening the browser is optional */ }
      }
      resolve(server);
    });
  });
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isEntryPoint()) {
  start().then((server) => {
    const shutdown = () => {
      flushHistory();
      server.close();
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (e) => console.error('Uncaught exception:', e));
    process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
  }, (e) => {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Is the dashboard already running? Or set PORT=4778.`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
}

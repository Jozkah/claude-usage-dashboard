/* Pure-ish HTTP helpers for server/index.js (no module-level side effects). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

export const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function sendJson(res, code, obj, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
  res.end(JSON.stringify(obj));
}

/** Lower-case, strip port, brackets and trailing dot from a host or Host header. */
export function normalizeHost(value) {
  let h = String(value || '').trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    h = end > 0 ? h.slice(1, end) : h.replace(/^\[/, '');
  } else if ((h.match(/:/g) || []).length === 1) {
    h = h.replace(/:\d*$/, '');
  }
  return h.replace(/\.$/, '');
}

export function parseAllowedHosts(list) {
  return new Set(['localhost', '127.0.0.1', '::1',
    ...String(list || '').split(',').map(normalizeHost).filter(Boolean)]);
}

export function hostAllowed(hostHeader, allowed) {
  return allowed.has(normalizeHost(hostHeader));
}

/** Browser-sent metadata: reject cross-site; no Origin means a non-browser client (allowed here, see token). */
export function originAllowed(headers) {
  const site = headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const o = headers.origin;
  if (!o) return true;
  try { return new URL(o).host.toLowerCase() === String(headers.host || '').toLowerCase(); } catch { return false; }
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** True when no token is configured or the request presents it (header or cookie). */
export function tokenOk(headers, token) {
  if (!token) return true;
  const given = String(headers['x-dashboard-token'] || cookieValue(headers.cookie, 'dashboard_token') || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

export function readBody(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        req.resume(); // drain so the 413 can be delivered
        reject(new HttpError(413, 'Request body too large.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

export function parseJsonText(text) {
  let value;
  try { value = JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Request body is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Request body must be a JSON object.');
  return value;
}

export async function parseJsonBody(req, limit) {
  return parseJsonText(await readBody(req, limit));
}

export function decodeId(raw) {
  try { return decodeURIComponent(raw); } catch { throw new HttpError(400, 'Malformed id.'); }
}

/**
 * Resolve a request path inside `dist`. Returns { status, file }.
 * 400 malformed escape, 403 traversal, 404 missing file with an extension, else SPA fallback to index.html.
 */
export function resolveStaticPath(dist, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return { status: 400 }; }
  if (rel.includes('\0')) return { status: 400 };
  if (rel === '/' || rel === '') rel = '/index.html';
  const root = path.resolve(dist);
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')));
  const r = path.relative(root, file);
  if (r.startsWith('..') || path.isAbsolute(r)) return { status: 403 };
  let st = null;
  try { st = fs.statSync(file); } catch { /* missing */ }
  if (st && st.isFile()) {
    try {
      const real = fs.realpathSync(file);
      const rr = path.relative(fs.realpathSync(root), real);
      if (rr.startsWith('..') || path.isAbsolute(rr)) return { status: 403 };
    } catch { return { status: 404 }; }
    return { status: 200, file };
  }
  if (path.extname(rel)) return { status: 404 };
  return { status: 200, file: path.join(root, 'index.html') };
}

export function streamFile(res, file, headers, method = 'GET') {
  fs.open(file, 'r', (err, fd) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end(err.code === 'ENOENT' ? 'Not found' : 'Could not read file');
    }
    res.writeHead(200, { ...SECURITY_HEADERS, ...headers });
    if (method === 'HEAD') { fs.close(fd, () => {}); return res.end(); }
    pipeline(fs.createReadStream(null, { fd, autoClose: true }), res, (e) => { if (e) res.destroy(); });
  });
}

/** Write via temp file + rename so a crash cannot leave a truncated file. */
export function writeFileAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

/** Share one in-flight promise per key. */
export function createInflight() {
  const map = new Map();
  return (key, run) => {
    const hit = map.get(key);
    if (hit) return hit;
    const p = Promise.resolve().then(run).finally(() => { if (map.get(key) === p) map.delete(key); });
    map.set(key, p);
    return p;
  };
}

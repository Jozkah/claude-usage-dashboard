/**
 * Claude Desktop "scratch" chats run in throwaway folders (scratch-2026-10-26-420c0a). A synced chat record keeps the
 * folder path of the profile it started in, and that path often does not exist for another profile: Windows shows an
 * MSIX app a private copy of AppData, and every profile keeps its scratch folders under its own data directory.
 * Desktop then has no folder to group those chats under, so they are missing next to the originals.
 *
 * This finds each scratch folder on disk (by its unique name) and makes a directory junction at every recorded path that
 * is missing, pointing at the real folder. When the folder no longer exists anywhere (Desktop cleans old ones up), an empty
 * folder is created at the recorded path so the chat still has a place to group under. Nothing is copied or deleted; an
 * existing path is never touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH = /^scratch-\d{4}-\d{2}-\d{2}-[0-9a-f]{4,}$/i;
const HEAD_BYTES = 8192;

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, HEAD_BYTES, 0)).toString('utf8');
  } finally { fs.closeSync(fd); }
}

/** Real scratch folders under one profile's data directory: <profile>/scratch-workspaces/<id>/<id>/scratch-*. */
function scratchFolders(profileDir) {
  const found = [];
  const root = path.join(profileDir, 'scratch-workspaces');
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (SCRATCH.test(e.name)) found.push(p);
      else if (depth < 3) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** Recorded working folders of every chat in a profile that point at a scratch folder. */
function recordedScratchPaths(profileDir) {
  const out = new Set();
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && /^local_.*\.json$/.test(e.name)) {
        try {
          for (const key of ['cwd', 'originCwd']) {
            const m = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(readHead(p));
            if (!m) continue;
            const value = JSON.parse(`"${m[1]}"`);
            if (SCRATCH.test(path.basename(value))) out.add(value);
          }
        } catch { /* unreadable record: skip */ }
      }
    }
  };
  walk(path.join(profileDir, 'claude-code-sessions'), 0);
  return out;
}

/**
 * @param {Record<string, string>} profiles profile id -> Desktop data directory
 * @param {{ home?: string }} [options] links are only made inside `home`
 * @returns {{ linked: number, created: number }}
 */
export function linkScratchWorkspaces(profiles, { home = os.homedir() } = {}) {
  const real = new Map(); // folder name -> real path
  for (const dir of Object.values(profiles)) for (const p of scratchFolders(dir)) if (!real.has(path.basename(p))) real.set(path.basename(p), p);
  const inHome = (p) => { const rel = path.relative(home, p); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
  let linked = 0;
  let created = 0;
  const wanted = new Set();
  for (const dir of Object.values(profiles)) for (const p of recordedScratchPaths(dir)) wanted.add(p);
  for (const link of wanted) {
    try { fs.lstatSync(link); continue; } catch { /* does not exist yet */ }
    const target = real.get(path.basename(link));
    if (!inHome(link) || (target && !inHome(target))) continue;
    try {
      fs.mkdirSync(path.dirname(link), { recursive: true });
      if (target) { fs.symlinkSync(target, link, 'junction'); linked++; }
      else { fs.mkdirSync(link); created++; } // the folder is gone everywhere
    } catch { /* locked or no permission: try again next round */ }
  }
  return { linked, created };
}

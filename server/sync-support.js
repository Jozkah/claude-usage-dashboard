import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_KEEP = 5;

// Small JSON state store for sync baselines (titles, labels, synced chats), backups and trash.
// Override the folder with DASHBOARD_SYNC_STATE_DIR.
export function defaultStateDir() {
  return process.env.DASHBOARD_SYNC_STATE_DIR || path.join(process.env.DATA_DIR || os.homedir(), '.claude-usage-sync');
}

// Backups live outside Desktop's scan paths, in <state dir>/backups.
export function backupsDir(stateDir) { return path.join(stateDir || defaultStateDir(), 'backups'); }

function backupBase(file) {
  const id = crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 8);
  return `${path.basename(file)}-${id}`;
}

function matching(dir, prefix, kind) {
  // Without a kind, leave kind-specific backups alone (their suffix starts with a letter, timestamps with a digit).
  return fs.readdirSync(dir).filter((name) => name.startsWith(prefix) &&
    (kind || /^\d/.test(name.slice(prefix.length)))).sort();
}

function pruneMatching(dir, prefix, kind, keep) {
  try {
    const names = matching(dir, prefix, kind);
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  } catch { /* pruning is best effort */ }
}

// Existing backups of `file` (oldest first), from the dedicated backups folder.
/** @param {string} file @param {string} [kind] @param {{ stateDir?: string }} [options] */
export function listBackups(file, kind = '', { stateDir } = {}) {
  const dir = backupsDir(stateDir);
  try { return matching(dir, `${backupBase(file)}.backup-${kind ? `${kind}-` : ''}`, kind).map((name) => path.join(dir, name)); }
  catch { return []; }
}

// Creates a uniquely named backup of `file` in the dedicated backups folder and keeps only
// the newest `keep` backups of the same kind. Works for files and directories.
/** @param {string} file @param {string} [kind] @param {{ keep?: number, stateDir?: string }} [options] */
export function createBackup(file, kind = '', { keep = DEFAULT_KEEP, stateDir } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const label = kind ? `${kind}-` : '';
  const directory = fs.statSync(file).isDirectory();
  const dir = backupsDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  let backup;
  for (let counter = 0; ; counter++) {
    backup = path.join(dir, `${backupBase(file)}.backup-${label}${stamp}${counter ? `-${counter}` : ''}`);
    try {
      if (directory) fs.cpSync(file, backup, { recursive: true, errorOnExist: true, force: false });
      else fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' || counter > 50) throw error;
    }
  }
  pruneBackups(file, kind, keep, stateDir);
  return backup;
}

export function pruneBackups(file, kind = '', keep = DEFAULT_KEEP, stateDir) {
  pruneMatching(backupsDir(stateDir), `${backupBase(file)}.backup-${kind ? `${kind}-` : ''}`, kind, keep);
  // Older versions left backups next to the original; keep those trimmed too.
  pruneMatching(path.dirname(file), `${path.basename(file)}.backup-${kind ? `${kind}-` : ''}`, kind, keep);
}

// Moves a file into <state dir>/trash/<label>/ instead of deleting it; keeps the newest `keep`.
/** @param {string} file @param {string} label @param {{ stateDir?: string, keep?: number }} [options] */
export function moveToTrash(file, label, { stateDir, keep = 200 } = {}) {
  const dir = path.join(stateDir || defaultStateDir(), 'trash', label);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `${stamp}-${backupBase(file)}`;
  let target;
  for (let counter = 0; ; counter++) {
    target = path.join(dir, counter ? `${base}-${counter}` : base);
    try { fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); break; }
    catch (error) { if (error.code !== 'EEXIST' || counter > 50) throw error; }
  }
  fs.rmSync(file, { force: true });
  try {
    const names = fs.readdirSync(dir).sort();
    for (const name of names.slice(0, Math.max(0, names.length - keep))) fs.rmSync(path.join(dir, name), { force: true });
  } catch { /* best effort */ }
  return target;
}

export function writeFileAtomic(file, content) {
  const temp = `${file}.sync-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

export function loadState(stateDir, name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(stateDir || defaultStateDir(), `${name}.json`), 'utf8')); }
  catch { return fallback; }
}

export function saveState(stateDir, name, value) {
  try {
    const dir = stateDir || defaultStateDir();
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(path.join(dir, `${name}.json`), JSON.stringify(value));
    return true;
  } catch { return false; }
}

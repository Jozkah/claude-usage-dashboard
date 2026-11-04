import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_KEEP = 5;

// Creates a uniquely named backup next to `file` and keeps only the newest `keep`
// backups of the same kind. Works for files and directories.
export function createBackup(file, kind = '', { keep = DEFAULT_KEEP } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const label = kind ? `${kind}-` : '';
  const directory = fs.statSync(file).isDirectory();
  let backup;
  for (let counter = 0; ; counter++) {
    backup = `${file}.backup-${label}${stamp}${counter ? `-${counter}` : ''}`;
    try {
      if (directory) fs.cpSync(file, backup, { recursive: true, errorOnExist: true, force: false });
      else fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' || counter > 50) throw error;
    }
  }
  pruneBackups(file, kind, keep);
  return backup;
}

export function pruneBackups(file, kind = '', keep = DEFAULT_KEEP) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.backup-${kind ? `${kind}-` : ''}`;
  try {
    // Without a kind, leave kind-specific backups alone (their suffix starts with a letter, timestamps with a digit).
    const names = fs.readdirSync(dir).filter((name) => name.startsWith(prefix) &&
      (kind || /^\d/.test(name.slice(prefix.length)))).sort();
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
  } catch { /* pruning is best effort */ }
}

export function writeFileAtomic(file, content) {
  const temp = `${file}.sync-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

// Small JSON state store for sync baselines (titles, labels, synced chats).
// Override the folder with DASHBOARD_SYNC_STATE_DIR.
export function defaultStateDir() {
  return process.env.DASHBOARD_SYNC_STATE_DIR || path.join(process.env.DATA_DIR || os.homedir(), '.claude-usage-sync');
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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBackup, loadState, saveState, moveToTrash } from './sync-support.js';

const POINTER = /^local_[0-9a-f-]+\.json$/i;

function listLeaves(profile) {
  const root = path.join(profile, 'claude-code-sessions');
  const leaves = [];
  let accounts;
  try { accounts = fs.readdirSync(root, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return leaves;
    throw error;
  }
  for (const account of accounts) {
    if (!account.isDirectory()) continue;
    for (const device of fs.readdirSync(path.join(root, account.name), { withFileTypes: true })) {
      if (device.isDirectory()) leaves.push(path.join(root, account.name, device.name));
    }
  }
  return leaves;
}

function newestPointerMtime(leaf) {
  let newest = 0;
  try {
    for (const file of fs.readdirSync(leaf)) {
      if (POINTER.test(file)) newest = Math.max(newest, fs.statSync(path.join(leaf, file)).mtimeMs);
    }
  } catch { /* unreadable leaf counts as empty */ }
  return newest;
}

// Account ids of the sidebar scopes in the profile config ("<account>/<org>" keys), lowercased.
export function activeAccountIds(profile) {
  try {
    const text = fs.readFileSync(path.join(profile, 'claude_desktop_config.json'), 'utf8').replace(/^﻿/, '');
    const scopes = JSON.parse(text).preferences?.epitaxyPrefs?.['dframe-code-sections'];
    return Object.keys(scopes && typeof scopes === 'object' ? scopes : {}).map((scope) => scope.split('/')[0].toLowerCase());
  } catch { return []; }
}

// A profile can hold several account/device folders (second sign-in, new device id). Active
// leaves are those of accounts signed in per the config; without a match the folder with the
// most recently modified pointer is used. Newest first.
export function activeSessionLeaves(profile) {
  const leaves = listLeaves(profile);
  if (!leaves.length) {
    const error = /** @type {NodeJS.ErrnoException} */ (new Error(`No local Desktop session folder found in profile ${profile}.`));
    error.code = 'NO_SESSION_FOLDER';
    throw error;
  }
  const ranked = leaves.map((leaf) => [leaf, newestPointerMtime(leaf)])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([leaf]) => leaf);
  const accounts = new Set(activeAccountIds(profile));
  const matching = ranked.filter((leaf) => accounts.has(path.basename(path.dirname(leaf)).toLowerCase()));
  return matching.length ? matching : ranked.slice(0, 1);
}

// The leaf where new pointers are written.
export function sessionLeaves(profile) { return activeSessionLeaves(profile)[0]; }

// Pointer name -> full path across every active leaf (newest copy wins).
function profileFiles(profile) {
  const files = new Map();
  const mtimes = new Map();
  for (const leaf of activeSessionLeaves(profile)) {
    for (const name of fs.readdirSync(leaf)) {
      if (!POINTER.test(name)) continue;
      const full = path.join(leaf, name);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch { continue; }
      if (!files.has(name) || mtimes.get(name) < mtime) { files.set(name, full); mtimes.set(name, mtime); }
    }
  }
  return files;
}

function recordError(options, file, error) {
  if (Array.isArray(options?.errors)) options.errors.push({ file, error: error?.message || String(error) });
}

function pairKey(a, b) {
  return [path.resolve(a), path.resolve(b)].sort().join('|').toLowerCase();
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sideKey = (profile) => path.resolve(profile).toLowerCase();

// Deleting a pointer in one profile removes the other profile's copy (moved to the sync trash,
// never hard-deleted) only when all of this holds: both profiles had it at an earlier tick,
// the remaining copy is byte-identical to what that tick recorded, it is older than minAgeMs,
// the session folders are the same as at that tick, and the missing side is not suspiciously
// empty or missing most of its chats.
/** @param {string} personalProfile @param {string} workProfile @param {{ minAgeMs?: number, inspectConflicts?: boolean, stateDir?: string, errors?: any[], propagateDeletions?: boolean }} [options] */
export function syncDesktopSessionRecords(personalProfile, workProfile, { minAgeMs = 0, inspectConflicts = true, stateDir, errors, propagateDeletions = true } = {}) {
  const sides = [{ profile: personalProfile, name: 'work' }, { profile: workProfile, name: 'personal' }];
  const leafOf = [sessionLeaves(personalProfile), sessionLeaves(workProfile)];
  const options = { errors };
  let toWork = 0;
  let toPersonal = 0;
  let conflicts = 0;
  let deleted = 0;
  // Pointers seen in both profiles (or copied by us) before. One that is later missing on
  // one side was deleted there, so it is not copied back.
  const state = loadState(stateDir, 'chat-pairs', {});
  const baselines = loadState(stateDir, 'chat-baselines', {});
  const key = pairKey(personalProfile, workProfile);
  const known = new Set(Array.isArray(state[key]) ? state[key] : []);
  const knownBefore = known.size;
  const baseline = baselines[key] || { layout: {}, files: {} };
  const keys = [sideKey(personalProfile), sideKey(workProfile)];
  const layout = Object.fromEntries(keys.map((k, i) => [k, activeSessionLeaves(sides[i].profile).join('|')]));
  const layoutStable = keys.every((k) => baseline.layout?.[k] === layout[k]);
  let maps = [profileFiles(personalProfile), profileFiles(workProfile)];

  if (propagateDeletions && layoutStable) {
    for (const [present, absent] of [[0, 1], [1, 0]]) {
      const missing = [...known].filter((file) => maps[present].has(file) && !maps[absent].has(file));
      if (!missing.length) continue;
      // A mass disappearance (wiped or unmounted side): not a user deleting chats.
      const knownHere = [...known].filter((file) => maps[present].has(file) || maps[absent].has(file)).length;
      if (missing.length > Math.max(3, Math.ceil(knownHere / 2))) continue;
      for (const file of missing) {
        const full = maps[present].get(file);
        try {
          const recorded = baseline.files?.[file]?.[keys[present]];
          if (!recorded) continue;
          const stat = fs.statSync(full);
          if (minAgeMs > 0 && Date.now() - stat.mtimeMs < minAgeMs) continue;
          if (sha(full) !== recorded) continue; // changed since both profiles last agreed: keep it
          moveToTrash(full, 'chat-pointers', { stateDir });
          known.delete(file);
          delete baseline.files[file];
          deleted++;
        } catch (error) { recordError(options, full, error); }
      }
    }
    maps = [profileFiles(personalProfile), profileFiles(workProfile)];
  }

  for (const file of maps[0].keys()) if (maps[1].has(file)) known.add(file);
  for (const [index, direction] of /** @type {[number, string][]} */ ([[0, 'work'], [1, 'personal']])) {
    const source = maps[index];
    const targetMap = maps[1 - index];
    const targetLeaf = leafOf[1 - index];
    for (const file of source.keys()) {
      const from = source.get(file);
      const to = path.join(targetLeaf, file);
      if (targetMap.has(file) || fs.existsSync(to)) continue;
      if (known.has(file)) continue; // deleted in the target profile
      const temp = path.join(targetLeaf, `.sync-${crypto.randomUUID()}.tmp`);
      try {
        const before = fs.statSync(from);
        if (minAgeMs > 0 && Date.now() - before.mtimeMs < minAgeMs) continue;
        let record;
        try { record = JSON.parse(fs.readFileSync(from, 'utf8')); }
        catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
        // Claude's live resume import creates a new pointer named after cliSessionId.
        // Copying either pointer again would create duplicate sidebar entries.
        if (record.adoptedFromOtherSurface ||
            (typeof record.cliSessionId === 'string' && /^[0-9a-f-]+$/i.test(record.cliSessionId) &&
             (targetMap.has(`local_${record.cliSessionId}.json`) || fs.existsSync(path.join(targetLeaf, `local_${record.cliSessionId}.json`))))) continue;
        fs.copyFileSync(from, temp, fs.constants.COPYFILE_EXCL);
        const after = fs.statSync(from);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
        JSON.parse(fs.readFileSync(temp, 'utf8'));
        // Linking a complete temporary copy makes the destination visible atomically.
        try { fs.linkSync(temp, to); }
        catch (error) {
          // File systems without hard links: fall back to rename, guarded by an existence check.
          if (!['EPERM', 'EINVAL', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
          if (fs.existsSync(to)) continue;
          fs.renameSync(temp, to);
        }
        known.add(file);
        if (direction === 'work') toWork++;
        else toPersonal++;
      } catch (error) {
        if (error.code !== 'EEXIST' && !(error instanceof SyntaxError)) recordError(options, from, error);
      } finally {
        fs.rmSync(temp, { force: true });
      }
    }
  }

  // Record what both profiles hold now, so a later one-sided disappearance can be proven a deletion.
  maps = [profileFiles(personalProfile), profileFiles(workProfile)];
  const files = {};
  for (const [file, personalFile] of maps[0]) {
    const workFile = maps[1].get(file);
    if (!workFile) continue;
    try {
      const hashes = [sha(personalFile), sha(workFile)];
      files[file] = { [keys[0]]: hashes[0], [keys[1]]: hashes[1] };
      if (inspectConflicts && hashes[0] !== hashes[1]) conflicts++;
    } catch (error) { recordError(options, workFile, error); }
  }
  const nextBaseline = { layout, files };
  if (known.size !== knownBefore || deleted) { state[key] = [...known]; saveState(stateDir, 'chat-pairs', state); }
  if (JSON.stringify(nextBaseline) !== JSON.stringify(baselines[key])) {
    baselines[key] = nextBaseline;
    saveState(stateDir, 'chat-baselines', baselines);
  }
  return { toWork, toPersonal, conflicts, deleted };
}

export function syncDesktopSessionRecordsMany(profiles, options = {}) {
  const ids = Object.keys(profiles);
  const copied = Object.fromEntries(ids.map((id) => [id, 0]));
  let conflicts = 0;
  let deleted = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const result = syncDesktopSessionRecords(profiles[ids[i]], profiles[ids[j]], options);
      copied[ids[j]] += result.toWork;
      copied[ids[i]] += result.toPersonal;
      conflicts += result.conflicts;
      deleted += result.deleted;
    }
  }
  return { copied, conflicts, deleted };
}

// Reads the checked-out branch straight from .git/HEAD (no git process, no event loop blocking).
// Follows the `gitdir:` pointer of linked worktrees. Returns null for detached HEAD or non-repos.
export function checkedOutBranch(worktreePath) {
  if (!worktreePath || !fs.existsSync(worktreePath)) return null;
  try {
    let directory = path.resolve(worktreePath);
    for (;;) {
      const dotGit = path.join(directory, '.git');
      const stat = fs.statSync(dotGit, { throwIfNoEntry: false });
      if (stat) {
        let gitDir = dotGit;
        if (stat.isFile()) {
          const match = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
          if (!match) return null;
          gitDir = path.resolve(directory, match[1]);
        }
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        return ref ? ref[1].trim() : null;
      }
      const parent = path.dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  } catch { return null; }
}

const finiteNumber = (value) => typeof value === 'number' ? Number.isFinite(value) : (value !== null && value !== '' && Number.isFinite(Number(value)));
const strictlyNewer = (source, target) => finiteNumber(source) && finiteNumber(target) && Number(source) > Number(target);
const unchanged = (before, after) => before.size === after.size && before.mtimeMs === after.mtimeMs;

// Call only after both Desktop profiles exit. Live Desktop workers can rewrite
// these pointers from memory, including stale empty records.
/** @param {string} personalProfile @param {string} workProfile @param {{ targetProfile?: string, errors?: any[], stateDir?: string }} [options] */
export function repairEmptyDesktopSessionRecords(personalProfile, workProfile, { targetProfile = 'both', errors, stateDir } = {}) {
  const personal = profileFiles(personalProfile);
  const work = profileFiles(workProfile);
  const pairs = [];
  for (const [file, personalFile] of personal) {
    if (work.has(file)) pairs.push([personalFile, work.get(file)]);
  }
  let repaired = 0;
  for (const [personalFile, workFile] of pairs) {
    let temp = null;
    try {
      const records = [personalFile, workFile].map((file) => {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (error) { if (error instanceof SyntaxError) return null; throw error; }
      });
      const [personalRecord, workRecord] = records;
      if (!personalRecord || !workRecord || personalRecord.sessionId !== workRecord.sessionId) continue;
      const complete = (record) => typeof record.cliSessionId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(record.cliSessionId) && Number(record.completedTurns) > 0;
      const empty = (record) => !record.cliSessionId && !(Number(record.completedTurns) > 0);
      const source = complete(personalRecord) && empty(workRecord) ? personalFile
        : complete(workRecord) && empty(personalRecord) ? workFile : null;
      if (!source) continue;
      const target = source === personalFile ? workFile : personalFile;
      if (targetProfile !== 'both' && targetProfile !== (target === personalFile ? 'personal' : 'work')) continue;
      const sourceRecord = source === personalFile ? personalRecord : workRecord;
      const targetRecord = source === personalFile ? workRecord : personalRecord;
      if (!strictlyNewer(sourceRecord.lastActivityAt, targetRecord.lastActivityAt)) continue;
      const before = fs.statSync(source);
      temp = `${target}.sync-${crypto.randomUUID()}.tmp`;
      fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
      if (!unchanged(before, fs.statSync(source))) continue;
      const copied = JSON.parse(fs.readFileSync(temp, 'utf8'));
      const checkedOut = checkedOutBranch(copied.worktreePath);
      if (checkedOut && copied.branch !== checkedOut) {
        copied.branch = checkedOut;
        fs.writeFileSync(temp, JSON.stringify(copied));
      }
      createBackup(target, '', { stateDir });
      fs.renameSync(temp, target);
      repaired++;
    } catch (error) { recordError({ errors }, personalFile, error); }
    finally { if (temp) fs.rmSync(temp, { force: true }); }
  }
  return repaired;
}

// Call only while target Desktop profile is closed. A pointer with fewer turns
// can keep showing an incomplete transcript even when both profiles share JSONL.
/** @param {string} personalProfile @param {string} workProfile @param {{ targetProfile?: string, errors?: any[], stateDir?: string }} [options] */
export function repairStaleDesktopSessionRecords(personalProfile, workProfile, { targetProfile = 'both', errors, stateDir } = {}) {
  const personal = profileFiles(personalProfile);
  const work = profileFiles(workProfile);
  let repaired = 0;
  for (const [name, personalFile] of personal) {
    const workFile = work.get(name);
    let personalRecord, workRecord;
    try {
      if (!workFile) continue;
      personalRecord = JSON.parse(fs.readFileSync(personalFile, 'utf8'));
      workRecord = JSON.parse(fs.readFileSync(workFile, 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) recordError({ errors }, personalFile, error);
      continue;
    }
    if (!personalRecord.sessionId || personalRecord.sessionId !== workRecord.sessionId) continue;
    for (const [source, target, sourceRecord, targetRecord, targetName] of [
      [personalFile, workFile, personalRecord, workRecord, 'work'],
      [workFile, personalFile, workRecord, personalRecord, 'personal'],
    ]) {
      if (targetProfile !== 'both' && targetProfile !== targetName) continue;
      const sourceTurns = Number(sourceRecord.completedTurns) || 0;
      const targetTurns = Number(targetRecord.completedTurns) || 0;
      if (sourceTurns <= targetTurns || sourceTurns <= 0 ||
          !strictlyNewer(sourceRecord.lastActivityAt, targetRecord.lastActivityAt) ||
          !/^[0-9a-f-]{36}$/i.test(sourceRecord.cliSessionId || '')) continue;
      if (targetTurns > 0 && sourceRecord.cliSessionId !== targetRecord.cliSessionId) continue;
      const temp = `${target}.sync-${crypto.randomUUID()}.tmp`;
      try {
        const before = fs.statSync(source);
        fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
        if (!unchanged(before, fs.statSync(source))) continue;
        const copied = JSON.parse(fs.readFileSync(temp, 'utf8'));
        const branch = checkedOutBranch(copied.worktreePath);
        if (branch && copied.branch !== branch) {
          copied.branch = branch;
          fs.writeFileSync(temp, JSON.stringify(copied));
        }
        createBackup(target, 'stale', { stateDir });
        fs.renameSync(temp, target);
        repaired++;
      } catch (error) { recordError({ errors }, target, error); }
      finally { fs.rmSync(temp, { force: true }); }
    }
  }
  return repaired;
}

// Call only while this profile is closed; Desktop otherwise rewrites records
// from memory. A stale branch can make an otherwise valid chat fail to open.
// Covers every active session folder of the profile.
/** @param {string} profilePath @param {{ errors?: any[], stateDir?: string }} [options] */
export function alignDesktopSessionBranches(profilePath, { errors, stateDir } = {}) {
  let aligned = 0;
  for (const leaf of activeSessionLeaves(profilePath)) {
    for (const name of fs.readdirSync(leaf)) {
      if (!POINTER.test(name)) continue;
      const file = path.join(leaf, name);
      const temp = `${file}.sync-${crypto.randomUUID()}.tmp`;
      try {
        let record;
        try { record = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (error) { if (error instanceof SyntaxError) continue; throw error; }
        if (!record.cliSessionId || !(Number(record.completedTurns) > 0)) continue;
        const branch = checkedOutBranch(record.worktreePath);
        if (!branch || !record.branch || branch === record.branch) continue;
        createBackup(file, 'branch', { stateDir });
        record.branch = branch;
        fs.writeFileSync(temp, JSON.stringify(record));
        fs.renameSync(temp, file);
        aligned++;
      } catch (error) { recordError({ errors }, file, error); }
      finally { fs.rmSync(temp, { force: true }); }
    }
  }
  return aligned;
}

// Run only while Work Desktop is closed. Its in-memory session index otherwise
// overwrites edited pointers. Personal's archive state controls shared visibility.
/** @param {string} personalProfile @param {string} workProfile @param {{ errors?: any[], stateDir?: string }} [options] */
export function reconcileWorkSessionRecords(personalProfile, workProfile, { errors, stateDir } = {}) {
  const personal = profileFiles(personalProfile);
  const work = profileFiles(workProfile);
  let updated = 0;
  for (const [name, source] of personal) {
    const target = work.get(name);
    if (!target) continue;
    const temp = `${target}.sync-${crypto.randomUUID()}.tmp`;
    try {
      // Stat both files before reading them; compare again right before the rename.
      const sourceBefore = fs.statSync(source);
      const targetBefore = fs.statSync(target);
      let personalRecord, workRecord;
      try {
        personalRecord = JSON.parse(fs.readFileSync(source, 'utf8'));
        workRecord = JSON.parse(fs.readFileSync(target, 'utf8'));
      } catch (error) { if (error instanceof SyntaxError) continue; throw error; }
      const merged = { ...workRecord };
      if (typeof personalRecord.isArchived === 'boolean') merged.isArchived = personalRecord.isArchived;
      const personalTurns = Number(personalRecord.completedTurns) || 0;
      const workTurns = Number(workRecord.completedTurns) || 0;
      if (personalTurns > workTurns || (personalTurns === workTurns &&
          Number(personalRecord.lastActivityAt) > Number(workRecord.lastActivityAt))) {
        for (const field of ['completedTurns', 'lastActivityAt', 'lastAssistantUuid',
          'postTurnSummary', 'postTurnSummaryFor', 'latestUserFrameAt']) {
          if (field in personalRecord) merged[field] = personalRecord[field];
        }
      }
      if (JSON.stringify(merged) === JSON.stringify(workRecord)) continue;
      fs.writeFileSync(temp, JSON.stringify(merged));
      if (!unchanged(sourceBefore, fs.statSync(source)) || !unchanged(targetBefore, fs.statSync(target))) continue;
      createBackup(target, 'reconcile', { stateDir });
      fs.renameSync(temp, target);
      updated++;
    } catch (error) { recordError({ errors }, target, error); }
    finally { fs.rmSync(temp, { force: true }); }
  }
  return updated;
}

export function findWindowsDesktopProfiles(local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) {
  if (process.platform !== 'win32') throw new Error('Desktop session sync currently supports Windows.');
  const packages = path.join(local, 'Packages');
  let entries;
  try { entries = fs.readdirSync(packages, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Claude Desktop packages folder not found: ${packages}`);
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^Claude_/.test(entry.name)) continue;
    const root = path.join(packages, entry.name, 'LocalCache');
    const publisher = entry.name.slice(entry.name.lastIndexOf('_') + 1).toLowerCase();
    const migratedPersonal = path.join(local, 'Claude-Data', `claude_${publisher}`);
    const legacyPersonal = path.join(root, 'Roaming', 'Claude');
    const personal = fs.existsSync(path.join(migratedPersonal, 'claude-code-sessions'))
      ? migratedPersonal : legacyPersonal;
    const legacyWork = path.join(root, 'Local', 'ClaudeProfiles', 'Work');
    const currentWork = path.join(local, 'ClaudeProfiles', 'Work');
    const work = fs.existsSync(path.join(legacyWork, 'claude-code-sessions'))
      ? legacyWork : currentWork;
    if (fs.existsSync(path.join(personal, 'claude-code-sessions')) && fs.existsSync(path.join(work, 'claude-code-sessions'))) {
      const profiles = { personal, work };
      const addExtras = (directory) => {
        if (!fs.existsSync(directory)) return;
        for (const extra of fs.readdirSync(directory, { withFileTypes: true })) {
          if (!extra.isDirectory() || extra.name.toLowerCase() === 'work') continue;
          const id = extra.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const profile = path.join(directory, extra.name);
          if (!id || Object.hasOwn(profiles, id)) continue;
          try { sessionLeaves(profile); profiles[id] = profile; }
          catch (error) {
            // A profile without Code sessions yet is expected; anything else is worth a log line.
            if (error.code !== 'NO_SESSION_FOLDER') console.warn(`Skipping Desktop profile ${profile}: ${error.message}`);
          }
        }
      };
      addExtras(path.join(root, 'Local', 'ClaudeProfiles'));
      addExtras(path.join(local, 'ClaudeProfiles'));
      return profiles;
    }
  }
  throw new Error('Personal and Work Claude Desktop profiles were not found.');
}

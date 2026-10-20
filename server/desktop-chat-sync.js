import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

function sessionLeaves(profile) {
  const root = path.join(profile, 'claude-code-sessions');
  const leaves = [];
  for (const account of fs.readdirSync(root, { withFileTypes: true })) {
    if (!account.isDirectory()) continue;
    for (const device of fs.readdirSync(path.join(root, account.name), { withFileTypes: true })) {
      if (device.isDirectory()) leaves.push(path.join(root, account.name, device.name));
    }
  }
  if (leaves.length !== 1) throw new Error('Expected one local Desktop session folder in each profile.');
  return leaves[0];
}

export function syncDesktopSessionRecords(personalProfile, workProfile, { minAgeMs = 0, inspectConflicts = true } = {}) {
  const personal = sessionLeaves(personalProfile);
  const work = sessionLeaves(workProfile);
  let toWork = 0;
  let toPersonal = 0;
  let conflicts = 0;
  for (const [source, target, direction] of [[personal, work, 'work'], [work, personal, 'personal']]) {
    for (const file of fs.readdirSync(source)) {
      if (!/^local_[0-9a-f-]+\.json$/i.test(file)) continue;
      const from = path.join(source, file);
      const to = path.join(target, file);
      if (fs.existsSync(to)) continue;
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
           fs.existsSync(path.join(target, `local_${record.cliSessionId}.json`)))) continue;
      const temp = path.join(target, `.sync-${crypto.randomUUID()}.tmp`);
      try {
        fs.copyFileSync(from, temp, fs.constants.COPYFILE_EXCL);
        const after = fs.statSync(from);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
        JSON.parse(fs.readFileSync(temp, 'utf8'));
        // Linking a complete temporary copy makes the destination visible atomically.
        fs.linkSync(temp, to);
        if (direction === 'work') toWork++;
        else toPersonal++;
      } catch (error) {
        if (error.code !== 'EEXIST' && !(error instanceof SyntaxError)) throw error;
      } finally {
        fs.rmSync(temp, { force: true });
      }
    }
  }
  if (inspectConflicts) {
    for (const file of fs.readdirSync(personal)) {
      if (!/^local_[0-9a-f-]+\.json$/i.test(file)) continue;
      const workFile = path.join(work, file);
      if (!fs.existsSync(workFile)) continue;
      const personalHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(personal, file))).digest('hex');
      const workHash = crypto.createHash('sha256').update(fs.readFileSync(workFile)).digest('hex');
      if (personalHash !== workHash) conflicts++;
    }
  }
  return { toWork, toPersonal, conflicts };
}

// Call only after both Desktop profiles exit. Live Desktop workers can rewrite
// these pointers from memory, including stale empty records.
function checkedOutBranch(worktreePath) {
  if (!worktreePath || !fs.existsSync(worktreePath)) return null;
  try {
    return execFileSync('git', ['-C', worktreePath, 'branch', '--show-current'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

export function repairEmptyDesktopSessionRecords(personalProfile, workProfile, { targetProfile = 'both' } = {}) {
  const personal = sessionLeaves(personalProfile);
  const work = sessionLeaves(workProfile);
  const pairs = [];
  for (const file of fs.readdirSync(personal)) {
    if (!/^local_[0-9a-f-]+\.json$/i.test(file) || !fs.existsSync(path.join(work, file))) continue;
    pairs.push([path.join(personal, file), path.join(work, file)]);
  }
  let repaired = 0;
  for (const [personalFile, workFile] of pairs) {
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
    if (Number(sourceRecord.lastActivityAt) <= Number(targetRecord.lastActivityAt)) continue;
    const before = fs.statSync(source);
    const temp = `${target}.sync-${crypto.randomUUID()}.tmp`;
    try {
      fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
      const after = fs.statSync(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
      const copied = JSON.parse(fs.readFileSync(temp, 'utf8'));
      const checkedOut = checkedOutBranch(copied.worktreePath);
      if (checkedOut && copied.branch !== checkedOut) {
        copied.branch = checkedOut;
        fs.writeFileSync(temp, JSON.stringify(copied));
      }
      const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
      repaired++;
    } finally { fs.rmSync(temp, { force: true }); }
  }
  return repaired;
}

// Call only while this profile is closed; Desktop otherwise rewrites records
// from memory. A stale branch can make an otherwise valid chat fail to open.
export function alignDesktopSessionBranches(profilePath) {
  const leaf = sessionLeaves(profilePath);
  let aligned = 0;
  for (const name of fs.readdirSync(leaf)) {
    if (!/^local_[0-9a-f-]+\.json$/i.test(name)) continue;
    const file = path.join(leaf, name);
    let record;
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    if (!record.cliSessionId || !(Number(record.completedTurns) > 0)) continue;
    const branch = checkedOutBranch(record.worktreePath);
    if (!branch || !record.branch || branch === record.branch) continue;
    const backup = `${file}.backup-branch-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
    const temp = `${file}.sync-${crypto.randomUUID()}.tmp`;
    try {
      record.branch = branch;
      fs.writeFileSync(temp, JSON.stringify(record));
      fs.renameSync(temp, file);
      aligned++;
    } finally { fs.rmSync(temp, { force: true }); }
  }
  return aligned;
}

// Run only while Work Desktop is closed. Its in-memory session index otherwise
// overwrites edited pointers. Personal's archive state controls shared visibility.
export function reconcileWorkSessionRecords(personalProfile, workProfile) {
  const personal = sessionLeaves(personalProfile);
  const work = sessionLeaves(workProfile);
  let updated = 0;
  for (const name of fs.readdirSync(personal)) {
    if (!/^local_[0-9a-f-]+\.json$/i.test(name)) continue;
    const source = path.join(personal, name);
    const target = path.join(work, name);
    if (!fs.existsSync(target)) continue;
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
    const before = fs.statSync(source);
    const temp = `${target}.sync-${crypto.randomUUID()}.tmp`;
    try {
      const after = fs.statSync(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
      fs.writeFileSync(temp, JSON.stringify(merged));
      fs.copyFileSync(target, `${target}.backup-reconcile-${new Date().toISOString().replace(/[:.]/g, '-')}`, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temp, target);
      updated++;
    } finally { fs.rmSync(temp, { force: true }); }
  }
  return updated;
}

export function findWindowsDesktopProfiles(local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) {
  if (process.platform !== 'win32') throw new Error('Desktop session sync currently supports Windows.');
  const packages = path.join(local, 'Packages');
  for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
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
      return { personal, work };
    }
  }
  throw new Error('Personal and Work Claude Desktop profiles were not found.');
}

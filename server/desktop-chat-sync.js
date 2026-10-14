import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

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

export function findWindowsDesktopProfiles() {
  if (process.platform !== 'win32') throw new Error('Desktop session sync currently supports Windows.');
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const packages = path.join(local, 'Packages');
  for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^Claude_/.test(entry.name)) continue;
    const root = path.join(packages, entry.name, 'LocalCache');
    const personal = path.join(root, 'Roaming', 'Claude');
    const work = path.join(root, 'Local', 'ClaudeProfiles', 'Work');
    if (fs.existsSync(path.join(personal, 'claude-code-sessions')) && fs.existsSync(path.join(work, 'claude-code-sessions'))) {
      return { personal, work };
    }
  }
  throw new Error('Personal and Work Claude Desktop profiles were not found.');
}

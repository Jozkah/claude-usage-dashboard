import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

export function syncDesktopSessionRecords(personalProfile, workProfile) {
  const personal = sessionLeaves(personalProfile);
  const work = sessionLeaves(workProfile);
  let toWork = 0;
  let toPersonal = 0;
  for (const [source, target, direction] of [[personal, work, 'work'], [work, personal, 'personal']]) {
    for (const file of fs.readdirSync(source)) {
      if (!/^local_[0-9a-f-]+\.json$/i.test(file)) continue;
      try {
        fs.copyFileSync(path.join(source, file), path.join(target, file), fs.constants.COPYFILE_EXCL);
        if (direction === 'work') toWork++;
        else toPersonal++;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  }
  return { toWork, toPersonal };
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

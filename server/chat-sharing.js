import fs from 'node:fs';
import path from 'node:path';

export function shareLocalChats(sourceConfig, targetConfig) {
  const source = path.join(sourceConfig, 'projects');
  const target = path.join(targetConfig, 'projects');
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Source account has no local Claude Code chats.');
  }
  if (!fs.statSync(targetConfig, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Target account folder does not exist.');
  }
  const sourceReal = fs.realpathSync(source);
  if (fs.realpathSync(targetConfig) === fs.realpathSync(sourceConfig)) {
    throw new Error('Choose two different account folders.');
  }
  const entry = fs.lstatSync(target, { throwIfNoEntry: false });
  if (entry) {
    let real = null;
    try { real = fs.realpathSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (real === null) {
      throw new Error('Target projects folder is a broken link. Remove it and try again.');
    }
    if (real === sourceReal) return { alreadyShared: true };
    if (entry.isDirectory() && fs.readdirSync(target).length === 0) {
      fs.rmdirSync(target); // empty folder created by Claude Code before any chat existed
    } else {
      throw new Error('Target already has local chats. Existing chats were left untouched.');
    }
  }
  // Windows junctions work without Developer Mode. Other platforms use directory symlinks.
  fs.symlinkSync(sourceReal, target, process.platform === 'win32' ? 'junction' : 'dir');
  return { alreadyShared: false };
}

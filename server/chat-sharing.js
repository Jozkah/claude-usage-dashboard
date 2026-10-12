import fs from 'node:fs';
import path from 'node:path';

export function shareLocalChats(sourceConfig, targetConfig) {
  const source = path.join(sourceConfig, 'projects');
  const target = path.join(targetConfig, 'projects');
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error('Source account has no local Claude Code chats.');
  }
  const sourceReal = fs.realpathSync(source);
  if (fs.realpathSync(targetConfig) === fs.realpathSync(sourceConfig)) {
    throw new Error('Choose two different account folders.');
  }
  try {
    if (fs.realpathSync(target) === sourceReal) return { alreadyShared: true };
    throw new Error('Target already has local chats. Existing chats were left untouched.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Windows junctions work without Developer Mode. Other platforms use directory symlinks.
  fs.symlinkSync(sourceReal, target, process.platform === 'win32' ? 'junction' : 'dir');
  return { alreadyShared: false };
}

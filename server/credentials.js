import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export const KEYCHAIN_TIMEOUT_MS = 3000;

function execFileAsync(cmd, args, options) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
}

/** Reads the Claude Code login for a config folder. File first; on macOS then the keychain (async, 3 s cap). */
export async function readCredentials(configDir, { platform = process.platform, exec = execFileAsync,
  home = os.homedir(), timeout = KEYCHAIN_TIMEOUT_MS } = {}) {
  try {
    const j = JSON.parse(await fs.readFile(path.join(configDir, '.credentials.json'), 'utf8'));
    if (j && j.claudeAiOauth) return j.claudeAiOauth;
  } catch { /* try the keychain next */ }

  if (platform === 'darwin') {
    const isDefault = path.resolve(configDir) === path.join(home, '.claude');
    const service = isDefault
      ? 'Claude Code-credentials'
      // Best effort: Claude Code suffixes the keychain item for custom config folders.
      : 'Claude Code-credentials-' + crypto.createHash('sha256').update(configDir).digest('hex').slice(0, 8);
    try {
      const out = await exec('security', ['find-generic-password', '-s', service, '-w'],
        { encoding: 'utf8', timeout, killSignal: 'SIGKILL' });
      const j = JSON.parse(out.trim());
      if (j && j.claudeAiOauth) return j.claudeAiOauth;
    } catch { /* not found, denied or timed out */ }
  }
  return null;
}

import fs from 'node:fs';
import path from 'node:path';

// CommandLineToArgvW-style tokenizer (backslash runs before a quote are halved).
export function splitWindowsCommandLine(command) {
  const args = [];
  let current = '';
  let inQuotes = false;
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === '\\') {
      let count = 0;
      while (command[i] === '\\') { count++; i++; }
      if (command[i] === '"') {
        current += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) current += '"'; else { inQuotes = !inQuotes; }
        started = true;
      } else { current += '\\'.repeat(count); i--; started = true; }
    } else if (char === '"') {
      if (inQuotes && command[i + 1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes;
      started = true;
    } else if (/\s/.test(char) && !inQuotes) {
      if (started) { args.push(current); current = ''; started = false; }
    } else { current += char; started = true; }
  }
  if (started) args.push(current);
  return args;
}

export function userDataDirFromCommandLine(command) {
  const args = splitWindowsCommandLine(command || '');
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--user-data-dir(?:=(.*))?$/i);
    if (!match) continue;
    const value = match[1] !== undefined ? match[1] : args[i + 1];
    if (value) return value;
  }
  return null;
}

function canonical(value) {
  let resolved = path.win32.normalize(value);
  try { resolved = fs.realpathSync.native(resolved); } catch { /* path may not exist; compare textually */ }
  return resolved.replace(/[\\/]+$/, '').toLowerCase();
}

const PACKAGED_APP = /\\WindowsApps\\Claude_[^\\]+\\app\\Claude\.exe$/i;

// Fails closed: a Claude Desktop process whose profile cannot be determined marks every profile as running.
export function parseDesktopProcessState(profiles, processes) {
  const state = Object.fromEntries(Object.keys(profiles).map((id) => [id, false]));
  const canonicalProfiles = Object.entries(profiles).map(([id, profile]) => [id, canonical(profile)]);
  const markAll = () => { for (const id of Object.keys(state)) state[id] = true; };
  for (const proc of processes || []) {
    const command = proc.CommandLine || '';
    const executable = proc.ExecutablePath || '';
    const isDesktop = PACKAGED_APP.test(executable) ||
      (/(^|[\\/])Claude\.exe$/i.test(executable) && /--user-data-dir/i.test(command));
    if (!isDesktop && !/--user-data-dir/i.test(command)) continue;
    const dir = userDataDirFromCommandLine(command);
    if (dir) {
      const directory = canonical(dir);
      const hit = canonicalProfiles.filter(([, profile]) => profile === directory);
      if (hit.length) for (const [id] of hit) state[id] = true;
      else if (isDesktop) markAll();
    } else if (PACKAGED_APP.test(executable)) {
      if ('personal' in state) state.personal = true; else markAll();
    } else if (isDesktop) markAll();
  }
  return state;
}

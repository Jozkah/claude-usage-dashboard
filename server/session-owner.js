import path from 'node:path';
import { userDataDirFromCommandLine } from './desktop-process-state.js';

const canonical = (value) => path.win32.normalize(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
const packagedDesktop = /\\WindowsApps\\Claude_[^\\]+\\app\\Claude\.exe$/i;

/** Attribute Desktop-created sessions to the profile running their Claude process. */
export function routeDesktopSessions(accounts, lists, profiles, processes) {
  const profileByPath = new Map(Object.entries(profiles).map(([id, directory]) => [canonical(directory), id]));
  const accountByProfile = new Map();
  for (const account of accounts) {
    if (account.provider) continue;
    const folder = path.win32.basename(String(account.configDir).replace(/[\\/]+$/, ''));
    const profile = account.id === 'personal' || folder.toLowerCase() === '.claude' ? 'personal'
      : folder.toLowerCase().startsWith('.claude-') ? folder.slice(8).toLowerCase() : null;
    if (profile) accountByProfile.set(profile, account.id);
  }
  const byPid = new Map(processes.map((process) => [Number(process.ProcessId), process]));
  const owner = (pid) => {
    const seen = new Set();
    while (Number.isInteger(pid) && pid > 0 && !seen.has(pid)) {
      seen.add(pid);
      const process = byPid.get(pid);
      if (!process) break;
      const dir = userDataDirFromCommandLine(process.CommandLine);
      if (dir) {
        const profile = profileByPath.get(canonical(dir));
        return profile ? accountByProfile.get(profile) : null;
      }
      if (!dir && packagedDesktop.test(process.ExecutablePath || '')) return accountByProfile.get('personal');
      pid = Number(process.ParentProcessId);
    }
    return null;
  };

  const routed = accounts.map(() => []);
  const indexById = new Map(accounts.map((account, index) => [account.id, index]));
  lists.forEach((list, index) => {
    for (const session of list) {
      const target = session.pid ? indexById.get(owner(session.pid)) ?? index : index;
      const { pid, ...publicSession } = session;
      const existing = routed[target].findIndex((item) => item.id === publicSession.id);
      if (existing < 0) routed[target].push(publicSession);
      else if (routed[target][existing].lastActiveAt < publicSession.lastActiveAt) routed[target][existing] = publicSession;
    }
  });
  const priority = (session) => session.state === 'paused' ? 2 : session.working ? 1 : 0;
  for (const list of routed) list.sort((a, b) => priority(b) - priority(a) || b.lastActiveAt - a.lastActiveAt);
  return routed;
}

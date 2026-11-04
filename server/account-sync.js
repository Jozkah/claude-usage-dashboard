import fs from 'node:fs';
import path from 'node:path';
import { shareLocalChats } from './chat-sharing.js';
import { syncCodeSetup } from './code-setup-sync.js';

/**
 * Keeps every account's Claude Code folder on the same chats and setup.
 * The first account is the hub: its `projects` folder is linked into every other account (live, no copies),
 * and skills, commands, agents, plugins and marketplaces are merged into a union across all of them.
 * Nothing is overwritten or deleted: copies only fill gaps, an account that already holds its own chats keeps them.
 *
 * @param {{ id: string, name?: string, configDir: string }[]} accounts configDir already expanded
 * @param {{ stateDir?: string, share?: typeof shareLocalChats, setup?: typeof syncCodeSetup }} [options]
 */
export function syncAllAccounts(accounts, { stateDir, share = shareLocalChats, setup = syncCodeSetup } = {}) {
  if (!Array.isArray(accounts) || accounts.length < 2) throw new Error('Add at least two accounts to sync them.');
  const real = (dir) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };
  const seen = new Set();
  const list = [];
  for (const account of accounts) {
    fs.mkdirSync(path.join(account.configDir, 'plugins'), { recursive: true }); // a fresh account has neither folder yet
    const key = real(account.configDir);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(account);
  }
  const [hub, ...others] = list;
  const results = others.map((account) => ({ id: account.id, name: account.name, chats: 'linked', setup: { skills: 0, commands: 0, agents: 0, plugins: 0, marketplaces: 0, settings: 0 }, errors: [] }));
  const byId = new Map(results.map((r) => [r.id, r]));

  fs.mkdirSync(path.join(hub.configDir, 'projects'), { recursive: true });
  for (const account of others) {
    const result = byId.get(account.id);
    try {
      result.chats = share(hub.configDir, account.configDir).alreadyShared ? 'already linked' : 'linked';
    } catch (error) {
      result.chats = 'kept separate';
      result.errors.push(`Chats: ${error.message}`);
    }
  }

  const add = (result, counts) => { for (const key of Object.keys(result.setup)) result.setup[key] += counts[key] || 0; };
  // Gather everything into the hub first, then fan the union back out to every account.
  for (const account of others) {
    try { setup(account.configDir, hub.configDir, { stateDir }); } catch (error) { byId.get(account.id).errors.push(`Setup to ${hub.id}: ${error.message}`); }
  }
  for (const account of others) {
    const result = byId.get(account.id);
    try { add(result, setup(hub.configDir, account.configDir, { stateDir })); } catch (error) { result.errors.push(`Setup: ${error.message}`); }
  }
  return { hub: hub.id, accounts: results };
}

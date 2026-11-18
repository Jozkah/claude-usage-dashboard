import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionLeaves } from './desktop-chat-sync.js';
import { loadState, saveState, writeFileAtomic } from './sync-support.js';

// Chats started in the Claude Code VS Code extension only exist as CLI transcripts
// (<config>/projects/<folder>/<id>.jsonl). Claude Desktop's Code tab lists a chat only when a
// pointer file (claude-code-sessions/<account>/<device>/local_<id>.json) names it, so each
// transcript gets a small "adopted" pointer, the same shape Desktop writes for sessions it adopts
// from another surface. The folder group is assigned later by the label sync.

const EDGE = 96 * 1024;
const POINTER = /^local_[0-9a-f-]+\.json$/i;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEdges(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const read = (position, length) => { const buffer = Buffer.alloc(length); fs.readSync(fd, buffer, 0, length, position); return buffer.toString('utf8'); };
    const head = read(0, Math.min(EDGE, size));
    const tail = size > EDGE ? read(size - EDGE, EDGE) : '';
    return { head, tail };
  } finally { fs.closeSync(fd); }
}

const lines = (text) => text.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const firstText = (record) => {
  const content = record?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.find((part) => part?.type === 'text')?.text : '';
  return typeof text === 'string' ? text : '';
};

/** Reads the facts a Desktop pointer needs from one transcript; null when it is not a VS Code chat. */
export function describeTranscript(file) {
  const stat = fs.statSync(file);
  if (!stat.size) return null;
  const { head, tail } = readEdges(file, stat.size);
  const first = lines(head);
  const last = lines(tail);
  const entrypoint = [...first, ...last].find((record) => record.entrypoint)?.entrypoint;
  if (entrypoint !== 'claude-vscode') return null;
  const cwd = [...first, ...last].find((record) => typeof record.cwd === 'string')?.cwd;
  if (!cwd) return null;
  const aiTitle = [...last].reverse().concat([...first].reverse()).find((record) => record.type === 'ai-title' && record.aiTitle)?.aiTitle;
  const prompt = first.find((record) => record.type === 'user' && firstText(record).trim());
  const title = (aiTitle || firstText(prompt).trim().replace(/\s+/g, ' ')).slice(0, 80) || 'VS Code chat';
  const model = [...last].reverse().concat(first).find((record) => typeof record.message?.model === 'string' && !record.message.model.startsWith('<'))?.message.model || '';
  const created = Date.parse(first.find((record) => record.timestamp)?.timestamp || '') || stat.birthtimeMs || stat.mtimeMs;
  return { cwd, title, model, createdAt: created, lastActivityAt: stat.mtimeMs, permissionMode: first.find((record) => record.permissionMode)?.permissionMode || 'default' };
}

/** Transcripts written by the VS Code extension under one Claude config directory. */
export function findVscodeTranscripts(configDir = path.join(os.homedir(), '.claude'), { minAgeMs = 60_000, now = Date.now() } = {}) {
  const root = path.join(configDir, 'projects');
  const found = [];
  let folders;
  try { folders = fs.readdirSync(root, { withFileTypes: true }); } catch { return found; }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    for (const name of fs.readdirSync(path.join(root, folder.name))) {
      const id = name.slice(0, -'.jsonl'.length);
      if (!name.endsWith('.jsonl') || !ID.test(id)) continue;
      const file = path.join(root, folder.name, name);
      try {
        if (now - fs.statSync(file).mtimeMs < minAgeMs) continue; // still being written
        const info = describeTranscript(file);
        if (info) found.push({ cliSessionId: id.toLowerCase(), file, ...info });
      } catch { /* unreadable transcript: skip */ }
    }
  }
  return found;
}

function knownSessionIds(profile) {
  const known = new Set();
  const root = path.join(profile, 'claude-code-sessions');
  let accounts = [];
  try { accounts = fs.readdirSync(root, { withFileTypes: true }); } catch { return known; }
  for (const account of accounts) {
    if (!account.isDirectory()) continue;
    for (const device of fs.readdirSync(path.join(root, account.name), { withFileTypes: true })) {
      if (!device.isDirectory()) continue;
      const leaf = path.join(root, account.name, device.name);
      for (const name of fs.readdirSync(leaf)) {
        if (!POINTER.test(name)) continue;
        known.add(name.slice('local_'.length, -'.json'.length).toLowerCase());
        try {
          const value = JSON.parse(fs.readFileSync(path.join(leaf, name), 'utf8'));
          if (value.cliSessionId) known.add(String(value.cliSessionId).toLowerCase());
        } catch { /* half-written pointer: its name is enough */ }
      }
    }
  }
  return known;
}

/**
 * Writes an adopted pointer for every VS Code chat that Desktop does not list yet. A chat that was
 * imported once is remembered, so deleting it in Desktop does not bring it back.
 * @param {string} profile Desktop profile folder (the one signed in to the account that owns configDir)
 * @param {{ configDir?: string, stateDir?: string, minAgeMs?: number }} [options]
 */
export function importVscodeChats(profile, { configDir, stateDir, minAgeMs } = {}) {
  const transcripts = findVscodeTranscripts(configDir, { minAgeMs });
  if (!transcripts.length) return { imported: 0 };
  const known = knownSessionIds(profile);
  const done = loadState(stateDir, 'vscode-imported', {});
  const leaf = sessionLeaves(profile);
  let imported = 0;
  for (const item of transcripts) {
    if (known.has(item.cliSessionId) || done[item.cliSessionId]) continue;
    const pointer = {
      sessionId: `local_${item.cliSessionId}`,
      cliSessionId: item.cliSessionId,
      cwd: item.cwd,
      originCwd: item.cwd,
      createdAt: item.createdAt,
      lastActivityAt: item.lastActivityAt,
      model: item.model,
      isArchived: false,
      title: item.title,
      permissionMode: item.permissionMode,
      alwaysAllowedReasons: [],
      sessionPermissionUpdates: [],
      adoptedFromOtherSurface: true,
      adoptedFrom: 'vscode',
    };
    writeFileAtomic(path.join(leaf, `${pointer.sessionId}.json`), JSON.stringify(pointer));
    done[item.cliSessionId] = Date.now();
    imported++;
  }
  if (imported) saveState(stateDir, 'vscode-imported', done);
  return { imported };
}

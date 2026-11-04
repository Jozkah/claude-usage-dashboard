import fs from 'node:fs';
import path from 'node:path';
import { mergeDesktopLabelSnapshotsThreeWay } from './desktop-auto-label-sync.js';
import { createBackup, writeFileAtomic, loadState, saveState } from './sync-support.js';

// Chromium Local Storage encoding and pending-marker behavior follow the
// MIT-licensed claude-desktop-session-sync project by RasmusKD.
const ORIGIN = 'https://claude.ai';
const prefix = Buffer.from(`_${ORIGIN}\0`, 'latin1');
const decode = (bytes) => bytes[0] === 0 ? bytes.subarray(1).toString('utf16le') : bytes.subarray(1).toString('latin1');
const encode = (value) => [...value].some((char) => char.charCodeAt(0) > 255)
  ? Buffer.concat([Buffer.from([0]), Buffer.from(value, 'utf16le')])
  : Buffer.concat([Buffer.from([1]), Buffer.from(value, 'latin1')]);
export { decode as decodeLocalStorageValue, encode as encodeLocalStorageValue };
const varint = (value) => {
  const result = [];
  let n = BigInt(value);
  do { let byte = Number(n & 127n); n >>= 7n; if (n) byte |= 128; result.push(byte); } while (n);
  return Buffer.from(result);
};

// classic-level is a native, optional dependency: load it lazily so the server runs without it.
let classicLevelPromise = null;
async function loadClassicLevel() {
  classicLevelPromise ||= import('classic-level').then((module) => module.ClassicLevel);
  try { return await classicLevelPromise; }
  catch (error) {
    classicLevelPromise = null;
    throw new Error(`Desktop label sync is unavailable: the optional "classic-level" package could not be loaded (${error.message}).`);
  }
}

export async function desktopLabelSyncStatus() {
  try { await loadClassicLevel(); return { available: true }; }
  catch (error) { return { available: false, error: error.message }; }
}

// Phase 1: open, validate and compute the write batch. Nothing is copied or changed here.
async function buildSidebarOps(db, scope, groups, sections) {
  const entries = new Map();
  let size = 0;
  for await (const [key, value] of db.iterator({ gte: prefix, lt: Buffer.concat([prefix, Buffer.from([255])]) })) {
    entries.set(decode(key.subarray(prefix.length)), { key, value });
    size += key.length - prefix.length + value.length;
  }
  const storeRecord = entries.get('dframe-store');
  const groupsRecord = entries.get('LSS-persisted.dframe-group-scopes');
  const sectionsRecord = entries.get('LSS-persisted.dframe-code-sections');
  const owner = entries.get('ccd-sync-owner');
  const pending = entries.get('ccd-sync-pending:ccd/dframe-store');
  if (!storeRecord || !groupsRecord || !sectionsRecord || !owner || decode(owner.value) !== scope.split('/')[0]) {
    throw Object.assign(new Error('Work sidebar store does not match its account scope.'), { code: 'SCOPE_OWNER_MISMATCH' });
  }
  if (pending && decode(pending.value) !== scope) throw new Error('Another account has an unsent sidebar change.');
  const store = JSON.parse(decode(storeRecord.value));
  const groupMirror = JSON.parse(decode(groupsRecord.value));
  const sectionMirror = JSON.parse(decode(sectionsRecord.value));
  if (!store.state?.customGroupsByScope || !store.state?.codeSidebarByScope ||
      !groupMirror.value || !sectionMirror.value) throw new Error('Desktop sidebar storage schema changed.');
  store.state.customGroupsByScope[scope] = groups;
  store.state.codeSidebarByScope[scope] = { ...store.state.codeSidebarByScope[scope], sections };
  groupMirror.value[scope] = groups;
  groupMirror.timestamp = Date.now();
  sectionMirror.value[scope] = { ...sectionMirror.value[scope], sections };
  sectionMirror.timestamp = Date.now();

  const ops = [];
  let delta = 0;
  for (const [record, value] of [
    [storeRecord, store],
    [groupsRecord, groupMirror],
    [sectionsRecord, sectionMirror],
  ]) {
    const bytes = encode(JSON.stringify(value));
    delta += bytes.length - record.value.length;
    ops.push({ type: 'put', key: record.key, value: bytes });
  }
  if (!pending) {
    const key = Buffer.concat([prefix, encode('ccd-sync-pending:ccd/dframe-store')]);
    const value = encode(scope);
    delta += key.length - prefix.length + value.length;
    ops.push({ type: 'put', key, value });
  }
  const meta = Buffer.concat([
    Buffer.from([8]), varint(BigInt(Date.now()) * 1000n + 11644473600000000n),
    Buffer.from([16]), varint(BigInt(size + delta)),
  ]);
  ops.push({ type: 'put', key: Buffer.from(`META:${ORIGIN}`, 'latin1'), value: meta });
  return ops;
}

// Validates first, backs up only when a write is about to happen, and removes that
// backup again if the write fails. `beforeCommit` runs after validation and may return a
// rollback function that is called when the LevelDB batch fails.
/** @param {string} profile @param {string} scope @param {any} groups @param {any} sections @param {{ beforeCommit?: Function, stateDir?: string }} [options] */
async function writeSidebarStore(profile, scope, groups, sections, { beforeCommit, stateDir } = {}) {
  const ClassicLevel = await loadClassicLevel();
  const root = path.join(profile, 'Local Storage', 'leveldb');
  const open = async () => {
    const db = new ClassicLevel(root, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
    await db.open(); // refuses writes while Claude holds the LevelDB lock
    return db;
  };
  let ops;
  const reader = await open();
  try { ops = await buildSidebarOps(reader, scope, groups, sections); }
  finally { await reader.close(); }

  const backup = createBackup(root, '', { keep: 3, stateDir });
  let rollback = null;
  try {
    rollback = (await beforeCommit?.()) || null;
    const writer = await open();
    try { await writer.batch(ops); }
    finally { await writer.close(); }
    return backup;
  } catch (error) {
    try { await rollback?.(); } catch { /* keep the original error */ }
    fs.rmSync(backup, { recursive: true, force: true });
    throw error;
  }
}

function readConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, ''));
}

// A profile can sign in several accounts, giving several sidebar scopes ("<account>/<org>").
// Each scope is its own participant in the merge; its chats are the pointers in the session
// folders of that account. With a single scope every session folder counts (legacy layout).
function readProfile(profile) {
  const configPath = path.join(profile, 'claude_desktop_config.json');
  const config = readConfig(configPath);
  const prefs = config.preferences?.epitaxyPrefs;
  const sectionScopes = prefs?.['dframe-code-sections'];
  const scopeKeys = sectionScopes && typeof sectionScopes === 'object' ? Object.keys(sectionScopes) : [];
  if (!prefs || !scopeKeys.length) {
    throw new Error(`No Desktop sidebar scope found in profile ${profile}; sign in to Claude Desktop with this profile first.`);
  }
  for (const scope of scopeKeys) {
    const entry = sectionScopes[scope];
    if (!entry || typeof entry !== 'object' || (entry.sections !== undefined && !Array.isArray(entry.sections))) {
      throw new Error(`Desktop sidebar schema changed in profile ${profile}: "dframe-code-sections" scope ${scope} has no sections list.`);
    }
    entry.sections ||= [];
  }
  const root = path.join(profile, 'claude-code-sessions');
  const leaves = [];
  for (const account of fs.readdirSync(root, { withFileTypes: true })) {
    if (!account.isDirectory()) continue;
    for (const device of fs.readdirSync(path.join(root, account.name), { withFileTypes: true })) {
      if (device.isDirectory()) leaves.push({ account: account.name.toLowerCase(), leaf: path.join(root, account.name, device.name) });
    }
  }
  const scopes = scopeKeys.map((scope) => {
    const owner = scope.split('/')[0].toLowerCase();
    const mine = leaves.filter((item) => item.account === owner);
    // One scope and no folder named after it: fall back to every folder, as before.
    const used = mine.length || scopeKeys.length > 1 ? mine : leaves;
    const records = new Map();
    for (const { leaf } of used) {
      for (const file of fs.readdirSync(leaf)) {
        if (!/^local_[0-9a-f-]+\.json$/i.test(file)) continue;
        const filename = path.join(leaf, file);
        let value;
        try { value = JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) { if (error instanceof SyntaxError) continue; throw error; }
        const ids = [...new Set([value.cliSessionId, value.sessionId].filter(Boolean))];
        if (!ids.length) continue;
        const mtime = fs.statSync(filename).mtimeMs;
        // Same-named pointers in several folders of one account: keep the most recently written.
        const key = file.slice(0, -5);
        if (!records.has(key) || records.get(key).mtime < mtime) records.set(key, { filename, value, ids, mtime });
      }
    }
    return { scope, records };
  });
  return { configPath, config, prefs, scopes };
}

// Flattens a profile into merge participants (one per sidebar scope).
function participantsOf(id, profilePath, profile) {
  return profile.scopes.map(({ scope, records }) => ({
    id: profile.scopes.length > 1 ? `${id}#${scope}` : id, profileId: id, profilePath,
    configPath: profile.configPath, config: profile.config, prefs: profile.prefs, scope, records, scopeCount: profile.scopes.length,
  }));
}

function snapshotOf(profile) {
  const groups = profile.prefs['dframe-group-scopes']?.[profile.scope] || {};
  const sections = profile.prefs['dframe-code-sections'][profile.scope].sections || [];
  const sessionId = (key) => key.startsWith('code:')
    ? `code:${profile.records.get(key.slice(5))?.value.sessionId || key.slice(5)}` : key;
  const assignments = Object.entries(groups.assignments || {}).map(([key, group]) => [sessionId(key), group]).sort();
  const order = Object.entries(groups.order || {}).map(([group, members]) =>
    [group, members.map(sessionId)]).sort();
  const manuals = sections.filter((section) => section.kind === 'manual').map((section) => ({
    ...section, members: (section.members || []).map(sessionId),
  }));
  const known = [...profile.records.keys()].map((key) => sessionId(`code:${key}`));
  return { groups: groups.groups || [], assignments, order, manuals, known };
}

// With several sidebar scopes, the scope whose chats changed most recently is the active one.
export function desktopLabelSnapshot(profilePath) {
  const all = participantsOf('profile', profilePath, readProfile(profilePath));
  const newest = (participant) => Math.max(0, ...[...participant.records.values()].map((record) => record.mtime));
  const active = all.sort((a, b) => newest(b) - newest(a))[0];
  const { known, ...snapshot } = snapshotOf(active);
  return snapshot;
}

function writeWithBackup(filename, value, stateDir) {
  const backup = createBackup(filename, '', { stateDir });
  writeFileAtomic(filename, JSON.stringify(value, null, 2) + '\n');
  return backup;
}

// Picks one title per chat. The pointer file mtime is a poor rename signal, so the last
// synced title is persisted: a profile whose title differs from it was renamed since.
function syncDesktopTitles(profiles, targets = profiles, stateDir) {
  let titles = 0;
  const targetFiles = new Set(targets.flatMap((profile) => [...profile.records.values()].map((record) => record.filename)));
  const state = loadState(stateDir, 'label-titles', {});
  let stateChanged = false;
  const byId = new Map();
  for (const profile of profiles) {
    for (const record of profile.records.values()) {
      for (const id of record.ids) {
        const peers = byId.get(id) || new Set();
        peers.add(record);
        byId.set(id, peers);
      }
    }
  }
  for (const [id, peerSet] of byId) {
    const peers = [...peerSet];
    if (peers.length < 2) continue;
    const named = peers.filter((record) => typeof record.value.title === 'string' && record.value.title);
    if (!named.length) continue;
    const last = state[id];
    const renamed = last === undefined ? [] : named.filter((record) => record.value.title !== last);
    const candidates = renamed.length ? renamed : named;
    const newest = [...candidates].sort((a, b) => b.mtime - a.mtime)[0];
    let allUpdated = true;
    for (const record of peers) {
      if (record.value.title === newest.value.title) continue;
      if (!targetFiles.has(record.filename)) { allUpdated = false; continue; }
      record.value.title = newest.value.title;
      writeWithBackup(record.filename, record.value, stateDir);
      titles++;
    }
    // Only advance the baseline once every peer carries the title; otherwise a pending peer would look "renamed".
    if (allUpdated && state[id] !== newest.value.title) { state[id] = newest.value.title; stateChanged = true; }
  }
  if (stateChanged) saveState(stateDir, 'label-titles', state);
  return titles;
}

/** @param {string} personalProfile @param {string} workProfile @param {{ targetProfile?: string, stateDir?: string }} [options] */
export async function syncMergedDesktopLabels(personalProfile, workProfile, { targetProfile = 'both', stateDir } = {}) {
  if (!['personal', 'work', 'both'].includes(targetProfile)) throw new Error(`Invalid target profile: ${targetProfile}`);
  return syncMergedDesktopLabelsMany({ personal: personalProfile, work: workProfile }, {
    targetIds: targetProfile === 'both' ? ['personal', 'work'] : [targetProfile], stateDir,
  });
}

/** @param {Record<string, string>} profiles @param {{ targetIds?: string[], stateDir?: string }} [options] */
export async function syncMergedDesktopLabelsMany(profiles, { targetIds = Object.keys(profiles), stateDir } = {}) {
  const ids = Object.keys(profiles);
  if (ids.length < 2 || targetIds.some((id) => !Object.hasOwn(profiles, id))) {
    throw new Error('Choose at least two Desktop profiles and valid target IDs.');
  }
  // One participant per profile, or per sidebar scope when a profile has several accounts.
  const participants = ids.flatMap((id) => participantsOf(id, profiles[id], readProfile(profiles[id])));
  const pids = participants.map((participant) => participant.id);
  const baselines = loadState(stateDir, 'label-baselines', {});
  const baselineKey = [...pids].sort().join('|');
  const merged = mergeDesktopLabelSnapshotsThreeWay(participants.map(snapshotOf),
    { baseline: baselines[baselineKey] || null, ids: pids });
  const targets = participants.filter((participant) => targetIds.includes(participant.profileId));
  const titles = syncDesktopTitles(participants, targets, stateDir);
  let updated = 0;
  const failures = [];
  const skippedScopes = [];
  for (const profile of targets) {
    const { id, profilePath } = profile;
    const bySessionId = new Map();
    for (const [key, record] of profile.records) bySessionId.set(record.value.sessionId, key);
    const translate = (key) => {
      if (!key.startsWith('code:')) return key;
      const target = bySessionId.get(key.slice(5));
      return target ? `code:${target}` : null;
    };
    const assignments = {};
    for (const [key, groupId] of merged.assignments) {
      const local = translate(key);
      if (local) assignments[local] = groupId;
    }
    const order = {};
    for (const [groupId, members] of merged.order) {
      order[groupId] = [...new Set(members.map(translate).filter(Boolean))];
    }
    const oldState = profile.prefs['dframe-group-scopes']?.[profile.scope];
    const oldSections = profile.prefs['dframe-code-sections'][profile.scope].sections;
    const nonManuals = oldSections.filter((section) => section.kind !== 'manual').map((section) => structuredClone(section));
    const manuals = merged.manuals.map((section) => ({ ...structuredClone(section),
      members: [...new Set((section.members || []).map(translate).filter(Boolean))] }));
    const sessionsIndex = nonManuals.findIndex((section) => section.kind === 'sessions');
    nonManuals.splice(sessionsIndex < 0 ? nonManuals.length : sessionsIndex, 0, ...manuals);
    nonManuals.forEach((section, index) => { section.order = index; });
    const nextState = { ...oldState, groups: structuredClone(merged.groups), assignments, order };
    if (JSON.stringify(oldState) === JSON.stringify(nextState) &&
        JSON.stringify(oldSections) === JSON.stringify(nonManuals)) continue;
    try {
      // Config first (cheap to roll back), then LevelDB; the config is re-read right before it is written.
      await writeSidebarStore(profilePath, profile.scope, nextState, nonManuals, {
        stateDir,
        beforeCommit: () => {
          const fresh = readConfig(profile.configPath);
          const freshPrefs = fresh.preferences.epitaxyPrefs;
          freshPrefs['dframe-group-scopes'] ||= {};
          freshPrefs['dframe-group-scopes'][profile.scope] = nextState;
          freshPrefs['dframe-code-sections'][profile.scope].sections = nonManuals;
          const backup = writeWithBackup(profile.configPath, fresh, stateDir);
          return () => writeFileAtomic(profile.configPath, fs.readFileSync(backup));
        },
      });
      profile.prefs['dframe-group-scopes'] ||= {};
      profile.prefs['dframe-group-scopes'][profile.scope] = nextState;
      profile.prefs['dframe-code-sections'][profile.scope].sections = nonManuals;
      updated++;
    } catch (error) {
      // Local Storage only tracks the signed-in account; other scopes of a multi-account profile are read-only.
      if (error.code === 'SCOPE_OWNER_MISMATCH' && profile.scopeCount > 1) skippedScopes.push(id);
      else failures.push(`${id}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
  // Remember what every profile now agrees on, so later runs can tell deletions from additions.
  if (targetIds.length === ids.length) {
    baselines[baselineKey] = { profiles: pids, groups: merged.groups, assignments: merged.assignments,
      order: merged.order, manuals: merged.manuals };
    saveState(stateDir, 'label-baselines', baselines);
  }
  return { titles, groups: merged.groups.length, assignments: merged.assignments.length, updated, skippedScopes,
    conflicts: merged.conflicts };
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ClassicLevel } from 'classic-level';

// Chromium Local Storage encoding and pending-marker behavior follow the
// MIT-licensed claude-desktop-session-sync project by RasmusKD.
const ORIGIN = 'https://claude.ai';
const prefix = Buffer.from(`_${ORIGIN}\0`, 'latin1');
const decode = (bytes) => bytes[0] === 0 ? bytes.subarray(1).toString('utf16le') : bytes.subarray(1).toString('latin1');
const encode = (value) => [...value].some((char) => char.charCodeAt(0) > 255)
  ? Buffer.concat([Buffer.from([0]), Buffer.from(value, 'utf16le')])
  : Buffer.concat([Buffer.from([1]), Buffer.from(value, 'latin1')]);
const varint = (value) => {
  const result = [];
  let n = BigInt(value);
  do { let byte = Number(n & 127n); n >>= 7n; if (n) byte |= 128; result.push(byte); } while (n);
  return Buffer.from(result);
};

async function writeSidebarStore(profile, scope, groups, sections) {
  const root = path.join(profile, 'Local Storage', 'leveldb');
  const backup = `${root}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.cpSync(root, backup, { recursive: true, errorOnExist: true, force: false });
  const db = new ClassicLevel(root, { keyEncoding: 'buffer', valueEncoding: 'buffer', createIfMissing: false });
  await db.open(); // refuses writes while Claude holds the LevelDB lock
  try {
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
      throw new Error('Work sidebar store does not match its account scope.');
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
    await db.batch(ops);
    return backup;
  } finally { await db.close(); }
}

function readProfile(profile) {
  const configPath = path.join(profile, 'claude_desktop_config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const prefs = config.preferences?.epitaxyPrefs;
  const sectionScopes = prefs?.['dframe-code-sections'];
  const scopeKeys = sectionScopes && Object.keys(sectionScopes);
  if (!prefs || scopeKeys?.length !== 1) throw new Error('Expected one Desktop sidebar scope per profile.');
  const scope = scopeKeys[0];
  const root = path.join(profile, 'claude-code-sessions');
  const records = new Map();
  for (const account of fs.readdirSync(root, { withFileTypes: true })) {
    if (!account.isDirectory()) continue;
    for (const device of fs.readdirSync(path.join(root, account.name), { withFileTypes: true })) {
      if (!device.isDirectory()) continue;
      const leaf = path.join(root, account.name, device.name);
      for (const file of fs.readdirSync(leaf)) {
        if (!/^local_[0-9a-f-]+\.json$/i.test(file)) continue;
        const filename = path.join(leaf, file);
        let value;
        try { value = JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) { if (error instanceof SyntaxError) continue; throw error; }
        const ids = [...new Set([value.cliSessionId, value.sessionId].filter(Boolean))];
        if (ids.length) records.set(file.slice(0, -5), { filename, value, ids, mtime: fs.statSync(filename).mtimeMs });
      }
    }
  }
  return { configPath, config, prefs, scope, records };
}

function writeWithBackup(filename, value) {
  const backup = `${filename}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
  const temp = `${filename}.sync-${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(temp, filename);
  } finally { fs.rmSync(temp, { force: true }); }
}

export async function syncDesktopLabels(personalProfile, workProfile) {
  const personal = readProfile(personalProfile);
  const work = readProfile(workProfile);
  const profiles = [personal, work];
  let titles = 0;
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
  for (const peerSet of byId.values()) {
    const peers = [...peerSet];
    if (peers.length !== 2) continue;
    const named = peers.filter((record) => typeof record.value.title === 'string' && record.value.title);
    if (!named.length) continue;
    const newest = named.sort((a, b) => b.mtime - a.mtime)[0];
    for (const record of peers) {
      if (record.value.title === newest.value.title) continue;
      record.value.title = newest.value.title;
      writeWithBackup(record.filename, record.value);
      titles++;
    }
  }

  const groupCount = (profile) => {
    const state = profile.prefs['dframe-group-scopes']?.[profile.scope];
    return (state?.groups?.length || 0) + Object.keys(state?.assignments || {}).length;
  };
  const source = groupCount(personal) >= groupCount(work) ? personal : work;
  const target = source === personal ? work : personal;
  const sourceState = source.prefs['dframe-group-scopes']?.[source.scope];
  if (!sourceState?.groups?.length) return { titles, groups: 0, assignments: 0 };

  const targetById = new Map();
  for (const [key, record] of target.records) {
    for (const id of record.ids) targetById.set(id, key);
  }
  const translate = (key) => {
    if (!key.startsWith('code:')) return key;
    const sourceRecord = source.records.get(key.slice(5));
    const targetKey = sourceRecord?.ids.map((id) => targetById.get(id)).find(Boolean);
    return targetKey ? `code:${targetKey}` : null;
  };
  const assignments = {};
  for (const [key, groupId] of Object.entries(sourceState.assignments || {})) {
    const translated = translate(key);
    if (translated) assignments[translated] = groupId;
  }
  const order = {};
  for (const [groupId, members] of Object.entries(sourceState.order || {})) {
    order[groupId] = members.map(translate).filter(Boolean);
  }
  const groups = structuredClone(sourceState.groups);
  const oldState = target.prefs['dframe-group-scopes']?.[target.scope];
  const sourceSections = source.prefs['dframe-code-sections'][source.scope].sections;
  const targetSections = target.prefs['dframe-code-sections'][target.scope].sections;
  const manuals = sourceSections.filter((section) => section.kind === 'manual').map((section) => ({
    ...structuredClone(section), members: (section.members || []).map(translate).filter(Boolean),
  }));
  const nonManuals = targetSections.filter((section) => section.kind !== 'manual').map((section) => structuredClone(section));
  const sessionsIndex = nonManuals.findIndex((section) => section.kind === 'sessions');
  nonManuals.splice(sessionsIndex < 0 ? nonManuals.length : sessionsIndex, 0, ...manuals);
  nonManuals.forEach((section, index) => { section.order = index; });
  const nextState = { ...oldState, groups, assignments, order };
  const changed = JSON.stringify(oldState) !== JSON.stringify(nextState) ||
    JSON.stringify(targetSections) !== JSON.stringify(nonManuals);
  if (changed) {
    await writeSidebarStore(target === personal ? personalProfile : workProfile, target.scope, nextState, nonManuals);
    target.prefs['dframe-group-scopes'] ||= {};
    target.prefs['dframe-group-scopes'][target.scope] = nextState;
    target.prefs['dframe-code-sections'][target.scope].sections = nonManuals;
    writeWithBackup(target.configPath, target.config);
  }
  return { titles, groups: changed ? groups.length : 0, assignments: changed ? Object.keys(assignments).length : 0 };
}

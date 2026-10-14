import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
        const id = value.cliSessionId || value.sessionId;
        if (id) records.set(file.slice(0, -5), { filename, value, id, mtime: fs.statSync(filename).mtimeMs });
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

export function syncDesktopLabels(personalProfile, workProfile) {
  const personal = readProfile(personalProfile);
  const work = readProfile(workProfile);
  const profiles = [personal, work];
  let titles = 0;
  const byId = new Map();
  for (const profile of profiles) {
    for (const record of profile.records.values()) {
      const peers = byId.get(record.id) || [];
      peers.push(record);
      byId.set(record.id, peers);
    }
  }
  for (const peers of byId.values()) {
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

  const targetById = new Map([...target.records].map(([key, record]) => [record.id, key]));
  const translate = (key) => {
    if (!key.startsWith('code:')) return key;
    const sourceRecord = source.records.get(key.slice(5));
    const targetKey = sourceRecord && targetById.get(sourceRecord.id);
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
    target.prefs['dframe-group-scopes'] ||= {};
    target.prefs['dframe-group-scopes'][target.scope] = nextState;
    target.prefs['dframe-code-sections'][target.scope].sections = nonManuals;
    writeWithBackup(target.configPath, target.config);
  }
  return { titles, groups: changed ? groups.length : 0, assignments: changed ? Object.keys(assignments).length : 0 };
}

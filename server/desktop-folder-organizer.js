import path from 'node:path';

const GENERAL_ID = 'cg-8f581a18-52e0-43da-ab7f-cb6320805902';
const folder = (value) => typeof value === 'string' ? path.win32.normalize(value).toLowerCase() : '';
const scratch = (value) => /^scratch-\d{4}-\d{2}-\d{2}-[0-9a-f]+$/i.test(path.win32.basename(value || ''));

// Keep Personal's explicit categories. Infer only from an exact working folder
// already categorized elsewhere; unrelated scratch chats share one category.
export function organizeDesktopFolders(snapshot, participants) {
  const result = structuredClone(snapshot);
  const assignments = new Map(result.assignments);
  const groupIds = new Set(result.groups.map((group) => group.id));
  const byFolder = new Map();
  const records = new Map();
  for (const participant of participants) {
    for (const record of participant.records.values()) {
      const id = `code:${record.value.sessionId}`;
      if (!records.has(id)) records.set(id, record.value);
    }
  }
  for (const [id, group] of assignments) {
    const record = records.get(id);
    const cwd = folder(record?.originCwd || record?.cwd);
    if (!cwd || !groupIds.has(group)) continue;
    if (!byFolder.has(cwd)) byFolder.set(cwd, new Set());
    byFolder.get(cwd).add(group);
  }
  const unresolved = [];
  let inferred = 0;
  for (const [id, record] of records) {
    if (assignments.has(id)) continue;
    const cwd = folder(record.originCwd || record.cwd);
    if (!cwd) continue;
    const matches = byFolder.get(cwd);
    if (matches?.size === 1) {
      assignments.set(id, [...matches][0]);
      inferred++;
    } else if (scratch(cwd)) unresolved.push(id);
  }
  if (unresolved.length) {
    let general = result.groups.find((group) => group.name.toLowerCase() === 'general');
    if (!general) {
      general = { id: GENERAL_ID, name: 'General', mode: 'code' };
      result.groups.push(general);
      result.order.push([general.id, []]);
      const template = result.manuals[0];
      result.manuals.push({ ...(template ? structuredClone(template) : {}),
        id: general.id, kind: 'manual', v: 2, name: general.name,
        order: result.manuals.length, members: [] });
    }
    for (const id of unresolved) assignments.set(id, general.id);
  }
  result.assignments = [...assignments].sort(([a], [b]) => a.localeCompare(b));
  return { snapshot: result, inferred, general: unresolved.length };
}

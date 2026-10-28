export function chooseAutomaticLabelSource(current, baseline) {
  if (!baseline) return current.personal === current.work ? 'personal' : null;
  const personalChanged = current.personal !== baseline.personal;
  const workChanged = current.work !== baseline.work;
  if (personalChanged && workChanged) return current.personal === current.work ? 'personal' : null;
  if (personalChanged) return 'personal';
  if (workChanged) return 'work';
  return 'personal';
}

export function chooseInitialLabelSource(personal, work) {
  if (JSON.stringify(personal) === JSON.stringify(work)) return 'personal';
  if (JSON.stringify(personal.groups) !== JSON.stringify(work.groups)) return null;
  if (JSON.stringify(personal.manuals) !== JSON.stringify(work.manuals)) return null;
  const includes = (larger, smaller) => {
    const assignments = new Map(larger.assignments);
    if (!smaller.assignments.every(([key, group]) => assignments.get(key) === group)) return false;
    const order = new Map(larger.order);
    return smaller.order.every(([group, members]) => {
      const full = order.get(group) || [];
      let index = 0;
      for (const member of full) if (member === members[index]) index++;
      return index === members.length;
    });
  };
  if (includes(personal, work)) return 'personal';
  if (includes(work, personal)) return 'work';
  return null;
}

export function mergeDesktopLabelSnapshots(personal, work) {
  const groups = [];
  const canonicalByName = new Map();
  const idMaps = [];
  for (const snapshot of [personal, work]) {
    const ids = new Map();
    for (const group of snapshot.groups) {
      const key = group.name.toLocaleLowerCase();
      let canonical = canonicalByName.get(key);
      if (!canonical) {
        canonical = structuredClone(group);
        canonicalByName.set(key, canonical);
        groups.push(canonical);
      }
      ids.set(group.id, canonical.id);
    }
    idMaps.push(ids);
  }
  const assignments = new Map();
  const order = new Map(groups.map((group) => [group.id, []]));
  const manualById = new Map();
  for (const [index, snapshot] of [personal, work].entries()) {
    const ids = idMaps[index];
    for (const [chat, groupId] of snapshot.assignments) {
      const canonical = ids.get(groupId);
      if (!canonical) throw new Error(`Unknown group ${groupId}.`);
      if (assignments.has(chat) && assignments.get(chat) !== canonical) {
        throw new Error(`Conflicting group assignment for ${chat}.`);
      }
      assignments.set(chat, canonical);
    }
    for (const [groupId, chats] of snapshot.order) {
      const canonical = ids.get(groupId);
      if (!canonical) continue;
      const members = order.get(canonical);
      for (const chat of chats) if (!members.includes(chat)) members.push(chat);
    }
    for (const manual of snapshot.manuals) {
      const canonical = ids.get(manual.id);
      if (!canonical) continue;
      if (!manualById.has(canonical)) manualById.set(canonical, { ...structuredClone(manual), id: canonical });
      else {
        const members = manualById.get(canonical).members ||= [];
        for (const chat of manual.members || []) if (!members.includes(chat)) members.push(chat);
      }
    }
  }
  const manuals = groups.map((group) => manualById.get(group.id)).filter(Boolean)
    .map((manual, index) => ({ ...manual, order: index }));
  return { groups, assignments: [...assignments].sort(([a], [b]) => a.localeCompare(b)),
    order: [...order].sort(([a], [b]) => a.localeCompare(b)), manuals };
}

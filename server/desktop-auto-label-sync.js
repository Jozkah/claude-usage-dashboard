// Three-way merge of Desktop sidebar label snapshots.
//
// Without a baseline the merge is a union (groups matched by case-insensitive name).
// With a baseline (the merged result of the previous successful sync) it also
// propagates deletions and renames: an item missing from a profile that was part of
// the baseline, and that still knew the chat, was deleted there. Conflicting
// assignments never abort the merge; they are returned in `conflicts`.
export function mergeDesktopLabelSnapshotsThreeWay(snapshots, { baseline = null, ids = [] } = {}) {
  const lower = (value) => String(value ?? '').toLocaleLowerCase();
  const covered = snapshots.map((_, index) => Boolean(baseline && ids[index] !== undefined &&
    (baseline.profiles || []).includes(ids[index])));
  const knownSets = snapshots.map((snapshot) => snapshot.known ? new Set(snapshot.known) : null);
  const knows = (index, chat) => !chat.startsWith('code:') || !knownSets[index] || knownSets[index].has(chat);

  const baseGroupKey = new Map((baseline?.groups || []).map((group) => [group.id, lower(group.name)]));
  const baseKeyById = baseGroupKey;
  // Effective group key per snapshot group: a renamed group keeps its baseline key so it still matches peers.
  const effective = snapshots.map((snapshot, index) => {
    const names = new Set(snapshot.groups.map((group) => lower(group.name)));
    return snapshot.groups.map((group) => {
      const baseKey = covered[index] ? baseKeyById.get(group.id) : undefined;
      const renamed = baseKey !== undefined && baseKey !== lower(group.name) && !names.has(baseKey);
      return { group, key: renamed ? baseKey : lower(group.name), renamed };
    });
  });

  const deletedKeys = new Set();
  for (const key of new Set(baseGroupKey.values())) {
    for (let index = 0; index < snapshots.length; index++) {
      if (covered[index] && !effective[index].some((entry) => entry.key === key)) deletedKeys.add(key);
    }
  }

  const groups = [];
  const canonicalByKey = new Map();
  const idMaps = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const idMap = new Map();
    for (const { group, key, renamed } of effective[index]) {
      if (deletedKeys.has(key)) { idMap.set(group.id, null); continue; }
      let canonical = canonicalByKey.get(key);
      if (!canonical) {
        canonical = structuredClone(group);
        canonicalByKey.set(key, canonical);
        groups.push(canonical);
      } else if (renamed && !canonical.renamed) canonical.name = group.name;
      if (renamed) canonical.renamed = true;
      idMap.set(group.id, canonical.id);
    }
    idMaps.push(idMap);
  }
  for (const group of groups) delete group.renamed;
  const groupIds = new Set(groups.map((group) => group.id));
  const toCanonical = (index, groupId) => idMaps[index].get(groupId); // undefined: unknown, null: deleted

  // Baseline group id -> canonical id (through the group key).
  const baseCanonical = (groupId) => {
    const key = baseKeyById.get(groupId);
    return key === undefined ? undefined : canonicalByKey.get(key)?.id;
  };

  const unknown = [];
  const conflicts = [];
  const perChat = new Map(); // chat -> Map(snapshotIndex -> canonical group id)
  for (const [index, snapshot] of snapshots.entries()) {
    for (const [chat, groupId] of snapshot.assignments) {
      const canonical = toCanonical(index, groupId);
      if (canonical === undefined) { unknown.push(groupId); continue; }
      if (canonical === null) continue;
      if (!perChat.has(chat)) perChat.set(chat, new Map());
      perChat.get(chat).set(index, canonical);
    }
  }
  const baseAssignments = new Map((baseline?.assignments || []).map(([chat, groupId]) => [chat, baseCanonical(groupId)]));
  for (const chat of baseAssignments.keys()) if (!perChat.has(chat)) perChat.set(chat, new Map());

  const assignments = new Map();
  for (const [chat, byIndex] of perChat) {
    const baseValue = baseAssignments.get(chat);
    const statuses = [];
    for (let index = 0; index < snapshots.length; index++) {
      if (byIndex.has(index)) statuses.push(byIndex.get(index));
      else if (covered[index] && baseValue !== undefined && knows(index, chat)) statuses.push(null);
    }
    const changes = statuses.filter((value) => value !== baseValue);
    let result = baseValue;
    if (changes.length) {
      const distinct = [...new Set(changes)];
      if (distinct.length > 1) {
        conflicts.push({ chat, groups: distinct.filter(Boolean) });
        result = distinct.find(Boolean) ?? null;
      } else result = distinct[0];
    }
    if (result && groupIds.has(result)) assignments.set(chat, result);
  }

  const order = new Map(groups.map((group) => [group.id, []]));
  for (const [index, snapshot] of snapshots.entries()) {
    for (const [groupId, chats] of snapshot.order) {
      const canonical = toCanonical(index, groupId);
      if (!canonical) continue;
      const members = order.get(canonical);
      for (const chat of chats) if (!members.includes(chat)) members.push(chat);
    }
  }
  if (baseline) {
    for (const [groupId, members] of order) {
      order.set(groupId, members.filter((chat) => assignments.get(chat) === groupId));
    }
  }

  const manualById = new Map();
  const memberSets = snapshots.map((snapshot, index) => new Map(snapshot.manuals.map((manual) =>
    [toCanonical(index, manual.id), new Set(manual.members || [])])));
  const baseManualMembers = new Map((baseline?.manuals || []).map((manual) =>
    [baseCanonical(manual.id), manual.members || []]));
  for (const [index, snapshot] of snapshots.entries()) {
    for (const manual of snapshot.manuals) {
      const canonical = toCanonical(index, manual.id);
      if (!canonical) continue;
      if (!manualById.has(canonical)) manualById.set(canonical, { ...structuredClone(manual), id: canonical });
      else {
        const members = manualById.get(canonical).members ||= [];
        for (const chat of manual.members || []) if (!members.includes(chat)) members.push(chat);
      }
    }
  }
  for (const [canonical, manual] of manualById) {
    const group = groups.find((entry) => entry.id === canonical);
    if (group && 'name' in manual) manual.name = group.name;
    const baseMembers = baseManualMembers.get(canonical) || [];
    manual.members = (manual.members || []).filter((chat) => {
      if (!baseMembers.includes(chat)) return true;
      for (let index = 0; index < snapshots.length; index++) {
        if (covered[index] && knows(index, chat) && memberSets[index].has(canonical) &&
            !memberSets[index].get(canonical).has(chat)) return false;
      }
      return true;
    });
  }
  const manuals = groups.map((group) => manualById.get(group.id)).filter(Boolean)
    .map((manual, index) => ({ ...manual, order: index }));
  return { groups, assignments: [...assignments].sort(([a], [b]) => a.localeCompare(b)),
    order: [...order].sort(([a], [b]) => a.localeCompare(b)), manuals, conflicts, unknown };
}

// Baseline-free union merge. Throws on conflicting or unknown assignments.
export function mergeDesktopLabelSnapshots(...snapshots) {
  const merged = mergeDesktopLabelSnapshotsThreeWay(snapshots);
  if (merged.unknown.length) throw new Error(`Unknown group ${merged.unknown[0]}.`);
  if (merged.conflicts.length) throw new Error(`Conflicting group assignment for ${merged.conflicts[0].chat}.`);
  const { groups, assignments, order, manuals } = merged;
  return { groups, assignments, order, manuals };
}

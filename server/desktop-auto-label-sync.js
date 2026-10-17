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

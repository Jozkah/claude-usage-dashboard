/** Plan tiers and the colour each one gets, so a card's plan is recognisable at a glance. */
export type PlanTier = 'free' | 'pro' | 'plus' | 'max5' | 'max20' | 'max' | 'team' | 'business' | 'unknown';

/** "Max 20x" -> max20, "Codex Plus" -> plus, "Team" -> team. Codex plans share the Claude tier colours. */
export function planTier(plan: string | null | undefined): PlanTier {
  const p = String(plan ?? '').toLowerCase().replace(/^codex\s+/, '').trim();
  if (!p) return 'unknown';
  if (p.startsWith('max')) return /20/.test(p) ? 'max20' : /5/.test(p) ? 'max5' : 'max';
  if (p === 'free') return 'free';
  if (p === 'pro') return 'pro';
  if (p === 'plus') return 'plus';
  if (p === 'team') return 'team';
  if (p === 'business' || p === 'enterprise' || p === 'edu') return 'business';
  return 'unknown';
}

// Full class strings so Tailwind can see them. Same hue family in light and dark, tuned for contrast on each.
const CLASSES: Record<PlanTier, string> = {
  free: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  pro: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  plus: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  max5: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  max20: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  max: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  team: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  business: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  unknown: 'bg-accent/12 text-accent',
};

export const planClasses = (plan: string | null | undefined): string => CLASSES[planTier(plan)];

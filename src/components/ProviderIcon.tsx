import type { Account } from '../lib/types';

export type Provider = 'claude' | 'codex';

export const providerOf = (a: Pick<Account, 'provider'>): Provider => (a.provider === 'codex' ? 'codex' : 'claude');

const NAMES: Record<Provider, string> = { claude: 'Claude Code account', codex: 'Codex (ChatGPT) account' };

/**
 * Small mark that tells accounts apart at a glance: a warm starburst for Claude Code,
 * a terminal prompt for Codex. Simple original glyphs, tinted through currentColor.
 */
export function ProviderIcon({ provider, className = 'size-4', title = true }: { provider: Provider; className?: string; title?: boolean }) {
  const label = NAMES[provider];
  const common = { viewBox: '0 0 24 24', className: `${className} shrink-0`, role: 'img' as const, 'aria-label': label };
  if (provider === 'codex') {
    return (
      <svg {...common} className={`${common.className} text-teal-600 dark:text-teal-300`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {title && <title>{label}</title>}
        <rect x="2.75" y="3.75" width="18.5" height="16.5" rx="4.5" />
        <path d="m7.5 9.5 3 2.5-3 2.5" />
        <path d="M13 15h3.5" />
      </svg>
    );
  }
  return (
    <svg {...common} className={`${common.className} text-[#d9774f]`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      {title && <title>{label}</title>}
      <path d="M12 2.8v18.4M3.7 7.4l16.6 9.2M3.7 16.6l16.6-9.2M6.4 4.6l11.2 14.8M17.6 4.6 6.4 19.4" />
    </svg>
  );
}

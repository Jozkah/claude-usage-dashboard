import type { Account } from '../lib/types';

export type Provider = 'claude' | 'codex';

export const providerOf = (a: Pick<Account, 'provider'>): Provider => (a.provider === 'codex' ? 'codex' : 'claude');

const NAMES: Record<Provider, string> = { claude: 'Claude Code account', codex: 'Codex (ChatGPT) account' };

/** Service marks (LobeHub icon set, MIT; the marks belong to Anthropic and OpenAI) served from /icons. */
export function ProviderIcon({ provider, className = 'size-4', title = true }: { provider: Provider; className?: string; title?: boolean }) {
  const label = NAMES[provider];
  return (
    <img
      src={`/icons/${provider}.svg`}
      alt={label}
      title={title ? label : undefined}
      width={24}
      height={24}
      draggable={false}
      className={`${className} shrink-0 ${provider === 'codex' ? 'rounded-[22%]' : ''}`}
    />
  );
}

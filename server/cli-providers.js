/**
 * Providers whose usage is read from a CLI's own login folder (not Claude Code). They report usage only:
 * chats, skills and plugins sync belong to Claude Code accounts.
 */
export const CLI_PROVIDERS = {
  codex: { label: 'Codex', command: 'codex', login: 'codex login', env: 'CODEX_HOME', folder: /^\.codex[\w-]*$/, example: '~/.codex-work' },
  grok: { label: 'Grok Build', command: 'grok', login: 'grok login', env: 'GROK_HOME', folder: /^\.grok[\w-]*$/, example: '~/.grok-work' },
};

export const isCliProvider = (provider) => typeof provider === 'string' && Object.hasOwn(CLI_PROVIDERS, provider);
/** Claude Code accounts are the ones without a CLI provider. */
export const isClaudeAccount = (account) => !isCliProvider(account && account.provider);

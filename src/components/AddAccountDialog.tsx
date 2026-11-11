import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { addAccount } from '../lib/api';
import { ProviderIcon } from './ProviderIcon';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

type Service = 'claude' | 'codex' | 'grok' | 'cursor';
const SERVICES: Record<Service, { label: string; product: string; folder: string; dir: string; env: string; login: string }> = {
  claude: { label: 'Claude Code', product: 'Claude Code', folder: 'Claude config folder', dir: '', env: 'CLAUDE_CONFIG_DIR', login: 'claude auth login' },
  codex: { label: 'Codex (ChatGPT plan)', product: 'Codex', folder: 'Codex folder', dir: '~/.codex', env: 'CODEX_HOME', login: 'codex login' },
  grok: { label: 'Grok Build', product: 'Grok', folder: 'Grok folder', dir: '~/.grok', env: 'GROK_HOME', login: 'grok login' },
  cursor: { label: 'Cursor', product: 'Cursor', folder: 'Cursor folder', dir: '~/.cursor', env: 'CURSOR_API_KEY', login: '' },
};

const inputCls =
  'w-full rounded-lg border border-line bg-frame px-3 py-2 text-sm outline-none transition-shadow placeholder:text-subtle-fg focus:ring-2 focus:ring-accent/40';

export const AddAccountDialog = memo(function AddAccountDialog({ open, onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [service, setService] = useState<Service>('claude');
  const [create, setCreate] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (open) { setName(''); setDir(''); setService('claude'); setCreate(false); setError(''); setBusy(false); }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    let err: string | null;
    try { err = await addAccount(name, dir, service === 'claude' ? undefined : service, service !== 'claude' && create); }
    catch (ex) { err = ex instanceof Error ? ex.message : 'Could not add the account.'; }
    finally { setBusy(false); }
    if (!openRef.current) return; // dialog was closed while the request ran
    if (err) return setError(err);
    onAdded();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add account">
      <form onSubmit={submit}>
        <label className="mb-1.5 block text-xs font-medium text-muted-fg" htmlFor="acc-name">Name</label>
        <input id="acc-name" autoFocus required maxLength={40} className={inputCls} placeholder="Work" value={name} onChange={(e) => setName(e.target.value)} />

        <fieldset className="mt-4">
          <legend className="mb-1.5 block text-xs font-medium text-muted-fg">Service</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SERVICES) as Service[]).map((value) => (
              <button type="button" key={value} aria-pressed={service === value}
                onClick={() => { setService(value); if (!dir || Object.values(SERVICES).some((x) => x.dir === dir)) setDir(SERVICES[value].dir); }}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${service === value ? 'border-fg bg-frame font-medium' : 'border-line hover:bg-frame'}`}>
                <span className="flex items-center gap-2"><ProviderIcon provider={value} title={false} />{SERVICES[value].label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 mb-1.5 block text-xs font-medium text-muted-fg" htmlFor="acc-dir">{SERVICES[service].folder}</label>
        <input id="acc-dir" required className={inputCls} placeholder={SERVICES[service].dir || '~/.claude-work'} value={dir} onChange={(e) => setDir(e.target.value)} />
        <p className="mt-2 text-xs leading-relaxed text-muted-fg">
          {service === 'claude' ? (
            <>The folder that account logs into (its <code className="rounded bg-frame px-1">CLAUDE_CONFIG_DIR</code>).
              Log in there once with Claude Code first. Running in Docker? Mount the folder under <code className="rounded bg-frame px-1">/accounts</code> instead.</>
          ) : (
            service === 'cursor' ? (
              <>Cursor keeps no login file here. Any folder works as a label (usually <code className="rounded bg-frame px-1">~/.cursor</code>); the plan is read with a Cursor API key. Start the dashboard server with <code className="rounded bg-frame px-1">CURSOR_API_KEY</code> set, or <code className="rounded bg-frame px-1">CURSOR_API_KEY_&lt;ACCOUNT_ID&gt;</code> for each extra account.</>
            ) : (
              <>The folder {SERVICES[service].product} stores its login in (<code className="rounded bg-frame px-1">{SERVICES[service].env}</code>, usually <code className="rounded bg-frame px-1">{SERVICES[service].dir}</code>). Sign in once with <code className="rounded bg-frame px-1">{SERVICES[service].login}</code> first.</>
            )
          )}
        </p>

        {service !== 'claude' && (
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-fg">
            <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} />
            Create the folder if it does not exist (for a second {SERVICES[service].product} login, e.g. <code className="rounded bg-frame px-1">{SERVICES[service].dir}-work</code>)
          </label>
        )}

        <p role="alert" className="mt-3 min-h-5 text-[13px] text-bad">{error}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-3.5 py-2 text-sm transition-colors hover:bg-frame">Cancel</button>
          <button disabled={busy} className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-60">
            {busy ? 'Adding…' : 'Add account'}
          </button>
        </div>
      </form>
    </Modal>
  );
});

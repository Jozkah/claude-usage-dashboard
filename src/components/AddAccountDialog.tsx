import { memo, useEffect, useRef, useState, type FormEvent } from 'react';
import { addAccount } from '../lib/api';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

const inputCls =
  'w-full rounded-lg border border-line bg-frame px-3 py-2 text-sm outline-none transition-shadow placeholder:text-subtle-fg focus:ring-2 focus:ring-accent/40';

export const AddAccountDialog = memo(function AddAccountDialog({ open, onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [codex, setCodex] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (open) { setName(''); setDir(''); setCodex(false); setError(''); setBusy(false); }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    let err: string | null;
    try { err = await addAccount(name, dir, codex ? 'codex' : undefined); }
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
          <div className="flex gap-2">
            {([['Claude Code', false], ['Codex (ChatGPT plan)', true]] as const).map(([label, value]) => (
              <button type="button" key={label} aria-pressed={codex === value}
                onClick={() => { setCodex(value); if (!dir || dir === '~/.codex') setDir(value ? '~/.codex' : ''); }}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${codex === value ? 'border-accent bg-frame font-medium' : 'border-line hover:bg-frame'}`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 mb-1.5 block text-xs font-medium text-muted-fg" htmlFor="acc-dir">{codex ? 'Codex folder' : 'Claude config folder'}</label>
        <input id="acc-dir" required className={inputCls} placeholder={codex ? '~/.codex' : '~/.claude-work'} value={dir} onChange={(e) => setDir(e.target.value)} />
        <p className="mt-2 text-xs leading-relaxed text-muted-fg">
          {codex ? (
            <>The folder Codex stores its login in (<code className="rounded bg-frame px-1">CODEX_HOME</code>, usually <code className="rounded bg-frame px-1">~/.codex</code>). Sign in once with <code className="rounded bg-frame px-1">codex login</code> first.</>
          ) : (
            <>The folder that account logs into (its <code className="rounded bg-frame px-1">CLAUDE_CONFIG_DIR</code>).
              Log in there once with Claude Code first. Running in Docker? Mount the folder under <code className="rounded bg-frame px-1">/accounts</code> instead.</>
          )}
        </p>

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

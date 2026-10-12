import { useEffect, useState, type FormEvent } from 'react';
import { addAccount } from '../lib/api';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

const inputCls =
  'w-full rounded-lg border border-line bg-frame px-3 py-2 text-sm outline-none transition-shadow placeholder:text-subtle-fg focus:ring-2 focus:ring-accent/40';

export function AddAccountDialog({ open, onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setName(''); setDir(''); setError(''); }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await addAccount(name, dir);
    setBusy(false);
    if (err) return setError(err);
    onAdded();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add account">
      <form onSubmit={submit}>
        <label className="mb-1.5 block text-xs font-medium text-muted-fg" htmlFor="acc-name">Name</label>
        <input id="acc-name" autoFocus required maxLength={40} className={inputCls} placeholder="Work" value={name} onChange={(e) => setName(e.target.value)} />

        <label className="mt-4 mb-1.5 block text-xs font-medium text-muted-fg" htmlFor="acc-dir">Claude config folder</label>
        <input id="acc-dir" required className={inputCls} placeholder="~/.claude-work" value={dir} onChange={(e) => setDir(e.target.value)} />
        <p className="mt-2 text-xs leading-relaxed text-muted-fg">
          The folder that account logs into (its <code className="rounded bg-frame px-1">CLAUDE_CONFIG_DIR</code>).
          Log in there once with Claude Code first. Running in Docker? Mount the folder under <code className="rounded bg-frame px-1">/accounts</code> instead.
        </p>

        <p className="mt-3 min-h-5 text-[13px] text-bad">{error}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-3.5 py-2 text-sm transition-colors hover:bg-frame">Cancel</button>
          <button disabled={busy} className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-60">
            {busy ? 'Adding…' : 'Add account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

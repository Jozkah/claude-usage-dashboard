import { memo, useEffect, useState } from 'react';
import type { Account } from '../lib/types';
import { Modal } from './Modal';
import { Select } from './Select';

interface Props {
  open: boolean;
  accounts: Account[];
  defaultSourceId: string;
  defaultTargetId: string;
  onClose: () => void;
  onRun: (sourceId: string, targetId: string) => void;
}

/** Pick which account's local Claude Code plugins and skills to copy, and where to. */
export const SyncSetupDialog = memo(function SyncSetupDialog({ open, accounts, defaultSourceId, defaultTargetId, onClose, onRun }: Props) {
  const [source, setSource] = useState(defaultSourceId);
  const [target, setTarget] = useState(defaultTargetId);

  useEffect(() => {
    if (open) { setSource(defaultSourceId); setTarget(defaultTargetId); }
  }, [open, defaultSourceId, defaultTargetId]);

  const options = accounts.map((a) => ({ value: a.id, label: a.name }));
  const same = source === target;

  return (
    <Modal open={open} onClose={onClose} title="Copy Claude Code plugins and skills">
      <p className="text-sm text-muted-fg">
        Copies the local plugins, plus any skills the target is missing, from one account’s Claude Code setup to another’s.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-fg">From</div>
          <Select label="Source account" value={source} onChange={setSource} options={options} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-fg">To</div>
          <Select label="Target account" value={target} onChange={setTarget} options={options} />
        </div>
      </div>
      <p role="alert" className="mt-3 min-h-5 text-[13px] text-bad">{same ? 'Choose two different accounts.' : ''}</p>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-line px-3.5 py-2 text-sm transition-colors hover:bg-frame">Cancel</button>
        <button disabled={same} onClick={() => onRun(source, target)} className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-60">
          Copy
        </button>
      </div>
    </Modal>
  );
});

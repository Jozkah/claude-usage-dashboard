import { useEffect, useState } from 'react';
import { Bell, BellOff, Moon, RefreshCw, Sparkles, Sun } from 'lucide-react';

interface Props {
  dark: boolean;
  loading: boolean;
  onToggleTheme: () => void;
  onRefresh: () => void;
  notify?: { supported: boolean; enabled: boolean; toggle: () => void };
  effects?: { on: boolean; toggle: () => void };
}

const SECTIONS = [
  { id: 'limits', label: 'Limits' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'resets', label: 'Resets' },
  { id: 'usage', label: 'Usage' },
] as const;

const iconBtn = 'grid size-8 place-items-center rounded-lg text-muted-fg transition-[color,background-color,transform] duration-150 hover:bg-frame hover:text-fg active:scale-[0.96]';

/** A plain sticky bar: name and section links on the left, small tools on the right. */
export function Header({ dark, loading, onToggleTheme, onRefresh, notify, effects }: Props) {
  // keep the icon spinning for a moment so a click on cached data still visibly does something
  const [spin, setSpin] = useState(false);
  const [current, setCurrent] = useState<string>('limits');
  const refresh = () => {
    setSpin(true);
    setTimeout(() => setSpin(false), 900);
    onRefresh();
  };

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) setCurrent(e.target.id); }), { rootMargin: '-35% 0px -60% 0px' });
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-12 w-full max-w-[1040px] items-center gap-6 px-4 sm:px-5">
        <span className="text-[14px] font-bold tracking-tight">Usage</span>
        <nav aria-label="Sections" className="-mb-px flex h-full min-w-0 flex-1 gap-1 overflow-x-auto">
          {SECTIONS.map(({ id, label }) => (
            <a
              key={id} href={`#${id}`} aria-current={current === id ? 'true' : undefined}
              className={`flex h-full items-center border-b-2 px-2.5 text-[13.5px] font-medium transition-colors duration-150 ${current === id ? 'border-fg text-fg' : 'border-transparent text-muted-fg hover:text-fg'}`}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-0.5">
          <button onClick={refresh} className={iconBtn} aria-label="Refresh now" title="Refresh now">
            <RefreshCw className={`size-4 ${loading || spin ? 'animate-[spin-slow_0.9s_linear_infinite]' : ''}`} />
          </button>
          {notify?.supported && (
            <button onClick={notify.toggle} className={iconBtn} aria-label="Limit notifications" aria-pressed={notify.enabled} title={notify.enabled ? 'Notifications on (85% and resets)' : 'Notify at 85% and on resets'}>
              {notify.enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            </button>
          )}
          {effects && (
            <button onClick={effects.toggle} className={iconBtn} aria-label="Motion effects" aria-pressed={effects.on} title={effects.on ? 'Motion effects on' : 'Motion effects off'}>
              <Sparkles className={`size-4 ${effects.on ? '' : 'opacity-50'}`} />
            </button>
          )}
          <button onClick={onToggleTheme} className={iconBtn} aria-label="Dark theme" aria-pressed={dark} title="Toggle theme">
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}

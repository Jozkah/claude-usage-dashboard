import { useState } from 'react';
import { Bell, BellOff, LayoutGrid, Menu, Moon, RefreshCw, Sun } from 'lucide-react';

interface Props {
  crumb: string;
  dark: boolean;
  loading: boolean;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onMenu: () => void;
  menuOpen?: boolean;
  notify?: { supported: boolean; enabled: boolean; toggle: () => void };
}

const iconBtn =
  'grid size-8 place-items-center rounded-lg border border-line bg-card text-muted-fg shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:text-fg';

export function Header({ crumb, dark, loading, onToggleTheme, onRefresh, onMenu, menuOpen = false, notify }: Props) {
  // keep the icon spinning for a moment so a click on cached data still visibly does something
  const [spin, setSpin] = useState(false);
  const refresh = () => {
    setSpin(true);
    setTimeout(() => setSpin(false), 900);
    onRefresh();
  };
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-2.5 text-[13px]">
        <button onClick={onMenu} className={`${iconBtn} lg:hidden`} aria-label="Menu" aria-expanded={menuOpen} aria-controls="mobile-sidebar"><Menu className="size-4" /></button>
        <LayoutGrid className="size-3.5 text-subtle-fg" />
        <span className="text-muted-fg">Overview</span>
        <span className="text-subtle-fg">/</span>
        <span className="font-medium">{crumb}</span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={refresh} className={iconBtn} aria-label="Refresh now" title="Refresh now">
          <RefreshCw className={`size-3.5 ${loading || spin ? 'animate-[spin-slow_0.9s_linear_infinite]' : ''}`} />
        </button>
        {notify?.supported && (
          <button onClick={notify.toggle} className={iconBtn} aria-label="Limit notifications" aria-pressed={notify.enabled} title={notify.enabled ? 'Notifications on (85% and resets)' : 'Notify at 85% and on resets'}>
            {notify.enabled ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
          </button>
        )}
        <button onClick={onToggleTheme} className={iconBtn} aria-label="Dark theme" aria-pressed={dark} title="Toggle theme">
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </header>
  );
}

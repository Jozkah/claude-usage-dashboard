import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { LONG_PRESS_MS, movedTooFar } from '../lib/keyboard';

interface Props {
  icon?: ReactNode;
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** Touch long-press at viewport coordinates (a context menu substitute for touch screens). */
  onLongPress?: (x: number, y: number) => void;
}

/** Ledger panel: one white rounded surface with a title row and a ruled body. */
export function FrameCard({ icon, title, right, children, className = '', bodyClassName = '', delay = 0, onContextMenu, onLongPress }: Props) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  useEffect(() => cancelPress, []);

  const touch = onLongPress ? {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button, a, input, select')) return;
      cancelPress();
      const x = e.clientX, y = e.clientY;
      press.current = { x, y, timer: setTimeout(() => { press.current = null; onLongPress(x, y); }, LONG_PRESS_MS) };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (press.current && movedTooFar(e.clientX - press.current.x, e.clientY - press.current.y)) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
  } : {};

  return (
    <section
      {...touch}
      onContextMenu={onContextMenu}
      className={`panel animate-rise flex min-w-0 flex-col ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-3 text-[13.5px] font-semibold tracking-tight text-fg">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        {right}
      </header>
      <div className={`flex-1 ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}

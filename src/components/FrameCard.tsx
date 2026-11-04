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
  beam?: boolean;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** Touch long-press at viewport coordinates (a context menu substitute for touch screens). */
  onLongPress?: (x: number, y: number) => void;
}

/**
 * Framed card: a soft grey outer frame with a title row, and a white inner
 * card that follows the cursor with a faint spotlight.
 */
export function FrameCard({ icon, title, right, children, className = '', bodyClassName = '', delay = 0, beam = false, onContextMenu, onLongPress }: Props) {
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  const body = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  useEffect(() => cancelPress, []);

  // the border beam only runs while its card is on screen
  useEffect(() => {
    const el = body.current;
    if (!beam || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => el.classList.toggle('beam-off', !entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [beam]);

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
      className={`animate-rise flex min-w-0 flex-col rounded-xl border border-line bg-frame ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="flex h-10 items-center justify-between gap-3 px-3.5 text-[13px] font-medium text-muted-fg">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        {right}
      </header>
      <div
        ref={body}
        onMouseMove={onMove}
        className={`spot ${beam ? 'beam' : ''} m-[3px] mt-0 flex-1 rounded-[9px] border border-line bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  );
}

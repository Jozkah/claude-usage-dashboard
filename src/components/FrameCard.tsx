import type { MouseEvent, ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
  beam?: boolean;
}

/**
 * Framed card: a soft grey outer frame with a title row, and a white inner
 * card that follows the cursor with a faint spotlight.
 */
export function FrameCard({ icon, title, right, children, className = '', bodyClassName = '', delay = 0, beam = false }: Props) {
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <section
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
        onMouseMove={onMove}
        className={`spot ${beam ? 'beam' : ''} m-[3px] mt-0 flex-1 rounded-[9px] border border-line bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  );
}

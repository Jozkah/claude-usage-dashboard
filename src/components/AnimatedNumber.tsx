import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion';

interface Props {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}

/** Counts smoothly from the previous value to the new one. */
export function AnimatedNumber({ value, decimals = 0, suffix = '', className = '' }: Props) {
  // start at the real value: only later changes animate, and reduced motion skips the count entirely
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    if (current.current === value) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        current.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [value]);

  return (
    <span className={`tabular-nums ${className}`}>
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}

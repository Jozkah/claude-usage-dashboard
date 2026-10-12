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
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
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

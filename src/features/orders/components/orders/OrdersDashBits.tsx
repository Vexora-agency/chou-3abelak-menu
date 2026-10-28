import React, { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { TrendingDown, TrendingUp } from 'lucide-react';

export const card = 'p-4 rounded-2xl bg-neutral-900 border border-neutral-800';

export const CountUp: React.FC<{ value: number; format: (n: number) => string }> = ({ value, format }) => {
  // Owner decision: dashboard animations always play for every visitor.
  const reduce = false;
  const from = useRef(0);
  const [text, setText] = useState(() => format(reduce ? value : 0));
  useEffect(() => {
    if (reduce) { setText(format(value)); from.current = value; return; }
    const c = animate(from.current, value, {
      duration: 0.9, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setText(format(v)),
      onComplete: () => { from.current = value; },
    });
    return () => c.stop();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{text}</>;
};

export const Delta: React.FC<{ cur: number; prev: number }> = ({ cur, prev }) => {
  if (prev <= 0) return <span className="text-[11px] text-neutral-500">—</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${up ? 'text-green-400' : 'text-red-400'}`}>
      <Icon size={12} aria-hidden="true" />
      <span dir="ltr">{up ? '+' : ''}{pct}%</span>
    </span>
  );
};

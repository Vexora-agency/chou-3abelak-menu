import React, { useRef } from 'react';
import { useEdgeSweep } from '@/src/hooks/useEdgeSweep';

interface EdgeSweepLineProps {
  position: 'top' | 'bottom';
}

// Gold edge line with a perpetually sweeping shine. The shine is a real div
// moved by rAF (see useEdgeSweep) — never a CSS keyframe — so phone power
// saving modes cannot freeze it. Same look everywhere: header, footer, login.
export const EdgeSweepLine: React.FC<EdgeSweepLineProps> = ({ position }) => {
  const sweepRef = useRef<HTMLDivElement>(null);
  useEdgeSweep(sweepRef);
  return (
    <div
      className={`edge-line ${position === 'top' ? 'edge-line-t' : 'edge-line-b'}`}
      aria-hidden="true"
    >
      <div ref={sweepRef} className="edge-sweep" aria-hidden="true" />
    </div>
  );
};

import React, { useId, useRef } from 'react';
import { usePathSweep } from '@/src/hooks/useEdgeSweep';

interface EdgeSweepLineProps {
  position: 'top' | 'bottom';
}

// One single line hugging the very edge: a short liquid-LED segment traveling
// along the shell's bottom (or top, mirrored). No static base curve, no second
// line — so nothing can ever cross or float off the edge. The faint halo comes
// from a drop-shadow on the segment itself, never a separate stroke.
const EDGE_D = 'M 0.5 30 C 0.5 32.5, 2 33, 6 33 L 94 33 C 98 33, 99.5 32.5, 99.5 30';

export const EdgeSweepLine: React.FC<EdgeSweepLineProps> = ({ position }) => {
  const cometRef = useRef<SVGPathElement>(null);
  usePathSweep(cometRef);
  // useId() contains colons — unsafe inside url(#...) references, so sanitize.
  const mid = `edgef${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div
      className={`edge-curve ${position === 'top' ? 'edge-curve-t' : 'edge-curve-b'}`}
      style={position === 'top' ? { transform: 'scaleY(-1)' } : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        <defs>
          {/* Moving window: a blurred white dash on black. Its dashoffset is
              driven by rAF (see usePathSweep) — never a CSS keyframe. */}
          <mask id={mid} maskUnits="userSpaceOnUse">
            <g filter={`url(#${mid}b)`}>
              <path
                ref={cometRef}
                d={EDGE_D}
                fill="none"
                stroke="#ffffff"
                strokeWidth="4"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="30 70"
              />
            </g>
          </mask>
          {/* Softens the window edges so the light reads as liquid, not cut. */}
          <filter id={`${mid}b`} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        {/* The one flowing line: bright gold revealed only inside the window. */}
        <path
          d={EDGE_D}
          fill="none"
          stroke="#FFE07A"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          pathLength={100}
          mask={`url(#${mid})`}
        />
      </svg>
    </div>
  );
};

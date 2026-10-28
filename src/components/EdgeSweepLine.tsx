import React, { useId, useRef } from 'react';
import { usePathSweep } from '@/src/hooks/useEdgeSweep';

interface EdgeSweepLineProps {
  position: 'top' | 'bottom';
}

// Curved gold edge accent with a perpetually traveling comet. The curve echoes
// the shell's rounded corners (far more visible on phones than the old 3 px
// straight bar). The comet is a dashed path whose dashoffset is set by rAF
// (see usePathSweep) — never a CSS keyframe — so phone power saving modes
// cannot freeze it. Same look everywhere: header, footer, login. `top`
// vertically mirrors the curve so it hugs top-rounded edges.
const CURVE_D = 'M 1.5 7 C 1.5 25, 13 32.5, 30 32.5 L 70 32.5 C 87 32.5, 98.5 25, 98.5 7';

export const EdgeSweepLine: React.FC<EdgeSweepLineProps> = ({ position }) => {
  const cometRef = useRef<SVGPathElement>(null);
  usePathSweep(cometRef);
  // useId() contains colons — unsafe inside url(#...) references, so sanitize.
  const gid = `edgeg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <div
      className={`edge-curve ${position === 'top' ? 'edge-curve-t' : 'edge-curve-b'}`}
      style={position === 'top' ? { transform: 'scaleY(-1)' } : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.22" style={{ stopColor: 'var(--primary)' }} />
            <stop offset="0.5" stopColor="#FFE07A" />
            <stop offset="0.78" style={{ stopColor: 'var(--primary)' }} />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id={`${gid}b`} x="-40%" y="-60%" width="180%" height="220%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        {/* Soft glow underlay (static: composited once) */}
        <path d={CURVE_D} fill="none" stroke={`url(#${gid})`} strokeWidth="7" pathLength={100} filter={`url(#${gid}b)`} opacity="0.5" />
        {/* Gold curve */}
        <path d={CURVE_D} fill="none" stroke={`url(#${gid})`} strokeWidth="3" pathLength={100} />
        {/* Traveling comet (dashoffset driven by rAF) */}
        <path
          ref={cometRef}
          d={CURVE_D}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.95"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="16 84"
        />
      </svg>
    </div>
  );
};

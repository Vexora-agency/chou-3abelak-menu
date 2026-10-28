import React, { useRef } from 'react';
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
  return (
    <div
      className={`edge-curve ${position === 'top' ? 'edge-curve-t' : 'edge-curve-b'}`}
      style={position === 'top' ? { transform: 'scaleY(-1)' } : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        {/* The one moving line: thin yellow segment, halo from its own shadow. */}
        <path
          ref={cometRef}
          d={EDGE_D}
          fill="none"
          stroke="#FFE07A"
          strokeOpacity="1"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="22 78"
          style={{ filter: 'drop-shadow(0 0 3px rgba(255,224,122,0.85))' }}
        />
      </svg>
    </div>
  );
};

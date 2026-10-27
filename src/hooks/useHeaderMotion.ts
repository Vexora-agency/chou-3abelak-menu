import { useScroll, useTransform } from 'motion/react';

export function useHeaderMotion() {
  const { scrollY } = useScroll();
  // Gentle depth on scroll: brand block drifts down a touch, the glow drifts up
  // (always on - site owner decision).
  const parY = useTransform(scrollY, [0, 320], [0, 46]);
  const glowY = useTransform(scrollY, [0, 320], [0, -30]);

  // Entrance choreography: content rises in while the logo video draws itself
  // (always on - site owner decision).
  const intro = 1.5;
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return { parY, glowY, intro, rise };
}

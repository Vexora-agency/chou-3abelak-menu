import { motion } from 'motion/react';

// Slow rising embers, a nod to the sizzle in the logo animation
const EMBERS = [
  { left: '8%', size: 3, rise: 520, dur: 11, delay: 0, drift: 14 },
  { left: '19%', size: 4, rise: 640, dur: 13, delay: 3.2, drift: -12 },
  { left: '30%', size: 3, rise: 460, dur: 9, delay: 1.4, drift: 10 },
  { left: '42%', size: 5, rise: 700, dur: 14, delay: 5.5, drift: -16 },
  { left: '53%', size: 3, rise: 500, dur: 10, delay: 2.4, drift: 12 },
  { left: '64%', size: 4, rise: 600, dur: 12, delay: 6.8, drift: -10 },
  { left: '74%', size: 3, rise: 480, dur: 9.5, delay: 0.8, drift: 14 },
  { left: '85%', size: 4, rise: 660, dur: 13, delay: 4.1, drift: -14 },
  { left: '93%', size: 3, rise: 440, dur: 10.5, delay: 7.3, drift: 8 },
];

interface LoginAtmosphereProps {
  reduce: boolean;
}

export function LoginAtmosphere({ reduce }: LoginAtmosphereProps): React.JSX.Element {
  return (
    <>
      {/* Atmosphere: warm spotlight, grain, floating brand mark, embers */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4 }}
      >
        <div className="header-spot" data-gsap-parallax="0.07" />
      </motion.div>
      <div className="header-grain" aria-hidden="true" />
      <motion.img
        src="/assets/pan-icon-yellow-336.webp"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute -bottom-12 -end-20 w-[340px] sm:w-[440px] opacity-[0.06] pointer-events-none select-none"
        initial={{ rotate: -14 }}
        animate={reduce ? { rotate: -14 } : { y: [0, -16, 0], rotate: [-14, -10, -14] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      {!reduce &&
        EMBERS.map((e, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="absolute bottom-0 rounded-full bg-[var(--primary)] pointer-events-none"
            style={{ left: e.left, width: e.size, height: e.size }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -e.rise, opacity: [0, 0.6, 0], x: [0, e.drift, 0] }}
            transition={{ duration: e.dur, delay: e.delay, repeat: Infinity, ease: 'linear' }}
          />
        ))}
    </>
  );
}

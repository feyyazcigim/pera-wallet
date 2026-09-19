import { animate, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Shared type-and-motion pieces of the pera. design language (landing page + dashboard). */
export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Yellow highlighter that wipes in when scrolled into view. */
export function Hl({ children, delay = 0.15 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.mark
      initial={{ backgroundSize: "0% 100%" }}
      whileInView={{ backgroundSize: "100% 100%" }}
      viewport={{ once: true, margin: "-120px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.mark>
  );
}

/** Headline line that slides up out of a mask on load. */
export function Line({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <span className="line">
      <motion.span initial={{ y: "105%" }} animate={{ y: 0 }} transition={{ duration: 0.8, delay, ease: EASE }}>
        {children}
      </motion.span>
    </span>
  );
}

/** Block that rises into place when it enters the viewport. */
export function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 36 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, delay, ease: EASE }}>
      {children}
    </motion.div>
  );
}

/** A number that counts to its value instead of snapping (balances, meters). */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const controls = animate(from.current, value, { duration: 0.9, ease: EASE, onUpdate: setShown });
    from.current = value;
    return () => controls.stop();
  }, [value]);
  return <>{format(shown)}</>;
}

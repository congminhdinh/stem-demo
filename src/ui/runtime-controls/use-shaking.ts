import { useEffect, useRef, useState } from 'react';
import { SHAKE_MS } from '../../core/simulation/peripherals/accelerometer';

// N17 B2: whether the board is being shaken, for what is drawn of it: true for SHAKE_MS (1 s) after `count` goes up, as long as
// `is_gesture("shake")` is true in the run. A count that goes back to 0 (a new run) is no shake. What the program reads is the
// run's (it times the shake itself); this is only how the board and the controls look meanwhile.

export function useShaking(count: number): boolean {
  const [shaking, setShaking] = useState(false);
  const seen = useRef(count);
  useEffect(() => {
    if (count === seen.current) {
      return;
    }
    const more = count > seen.current;
    seen.current = count;
    setShaking(more);
    if (!more) {
      return;
    }
    const timer = setTimeout(() => setShaking(false), SHAKE_MS);
    return () => clearTimeout(timer);
  }, [count]);
  return shaking;
}

/** Whether the person asked for less motion: then the board is not jiggled, only marked. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

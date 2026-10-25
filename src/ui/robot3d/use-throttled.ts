import { useEffect, useRef, useState } from 'react';
import { createLatestThrottle, type LatestThrottle } from '../blockly/latest-throttle';

/**
 * `value`, changing at most once every `delayMs` and always ending on the latest (the same throttle as Blockly's running-block highlight,
 * N18 R2.4): a change after a quiet time shows at once, a tight run of changes shows the first and then one per interval. A debounce would
 * wait for a quiet that a program in a loop never gives.
 */
export function useThrottled<T>(value: T, delayMs: number): T {
  const [shown, setShown] = useState(value);
  const throttle = useRef<LatestThrottle<T> | null>(null);
  useEffect(() => {
    const made = createLatestThrottle<T>(setShown, delayMs, value);
    throttle.current = made;
    return () => {
      made.dispose();
      throttle.current = null;
    };
    // The throttle is made once for an interval, from the value the view starts with; the next effect feeds it the changes.
  }, [delayMs]);
  useEffect(() => {
    throttle.current?.request(value);
  }, [value]);
  return shown;
}

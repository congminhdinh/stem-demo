/**
 * A throttle that always ends on the latest value (N18 R2.4, the highlight of the running block). `request(value)` shows the value
 * at once when nothing was shown in the last `delayMs` (the leading edge), and otherwise remembers it; when the `delayMs` that
 * followed the last show are over, the latest value remembered is shown (the trailing edge), which starts the next `delayMs`. So the
 * value changes at most once every `delayMs`, however fast it is requested, it never goes stale (a debounce would wait for a quiet
 * that a tight loop never gives), and the last value requested is always shown within `delayMs`.
 *
 * Only the timer of the platform is used, no clock, so a fake timer drives it exactly. A value equal to the one shown costs nothing
 * and starts no delay. `dispose` cancels the pending show for good.
 */
export type LatestThrottle<T> = {
  request(value: T): void;
  dispose(): void;
};

export function createLatestThrottle<T>(show: (value: T) => void, delayMs: number, initial: T): LatestThrottle<T> {
  let shown = initial;
  let wanted = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const settle = () => {
    timer = undefined;
    if (wanted !== shown) {
      showWanted();
    }
  };
  function showWanted() {
    shown = wanted;
    timer = setTimeout(settle, delayMs);
    show(shown);
  }
  return {
    request(value) {
      wanted = value;
      if (!disposed && timer === undefined && wanted !== shown) {
        showWanted();
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

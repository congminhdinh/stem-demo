// What holds a board button closed, as one value for the run (plan §11.3, `hold`). A button can be held by
// a pointer, by a key, or by both at once; it is closed while anything holds it and open when nothing does.
// Every operation answers with the new `closed` value when it changed and with undefined when it did not,
// so the control sends the run a value only when there is a new one, never the same twice in a row.

export type HoldTracker = {
  /** `source` starts holding the button. */
  hold(source: string): boolean | undefined;
  /** `source` stops holding it; releasing something that does not hold it changes nothing. */
  release(source: string): boolean | undefined;
  /** Nothing holds it any more: focus lost, the control disabled or removed. */
  releaseAll(): boolean | undefined;
};

export function createHoldTracker(): HoldTracker {
  const sources = new Set<string>();
  const changeFrom = (wasClosed: boolean) => (sources.size > 0 === wasClosed ? undefined : !wasClosed);
  return {
    hold(source) {
      const wasClosed = sources.size > 0;
      sources.add(source);
      return changeFrom(wasClosed);
    },
    release(source) {
      const wasClosed = sources.size > 0;
      sources.delete(source);
      return changeFrom(wasClosed);
    },
    releaseAll() {
      const wasClosed = sources.size > 0;
      sources.clear();
      return changeFrom(wasClosed);
    },
  };
}

/** The keys that hold a focused button, as a native button is pressed (plan §19). */
export const isHoldKey = (key: string) => key === ' ' || key === 'Enter';

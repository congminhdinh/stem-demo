import { createHoldTracker, type HoldTracker } from './hold-tracker';

// N17 B4: the buttons of a running board are held by more than one hand: a panel button (by a pointer or a key), the panel's
// A+B, and the buttons drawn on the board (by a pointer). They share one state per button, a hold tracker: closed while anything
// holds it, open when nothing does. The run is told only when that changes (`onChange`), so a press on the drawing while the panel
// holds the same button is still one press (get_presses counts it once), and every control shows the same state. A hand is a
// source named `<owner>/<detail>` (`panel:button-a/pointer:1`, `board/pointer:3`), so an owner can let go of everything it holds
// at once (a control that loses focus or goes away, the drawing when the run stops taking presses). Runtime state of one run.

export type ButtonHolds = {
  /** `source` (`<owner>/<detail>`) holds the button `componentId` (`<board>/<part>`). */
  hold(componentId: string, source: string): void;
  /** `source` lets go of the button; letting go of what it does not hold changes nothing. */
  release(componentId: string, source: string): void;
  /** Every source of `owner` lets go of every button it holds. */
  releaseOwner(owner: string): void;
  /** Nothing holds anything any more: the run ended. */
  releaseAll(): void;
  /** Whether anything holds the button now. */
  isClosed(componentId: string): boolean;
  /** Called after every change of a button; returns the way to stop listening. */
  subscribe(listener: () => void): () => void;
};

export function createButtonHolds(onChange: (componentId: string, closed: boolean) => void): ButtonHolds {
  // By component id; a Map, because ids are data ("constructor" is an id, not a member).
  const trackers = new Map<string, { tracker: HoldTracker; sources: Set<string>; closed: boolean }>();
  const listeners = new Set<() => void>();
  const entryOf = (componentId: string) => {
    let entry = trackers.get(componentId);
    if (!entry) {
      entry = { tracker: createHoldTracker(), sources: new Set(), closed: false };
      trackers.set(componentId, entry);
    }
    return entry;
  };
  const changed = (componentId: string, closed: boolean | undefined) => {
    if (closed === undefined) {
      return;
    }
    entryOf(componentId).closed = closed;
    onChange(componentId, closed);
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const release = (componentId: string, source: string) => {
    const entry = trackers.get(componentId);
    if (entry?.sources.delete(source)) {
      changed(componentId, entry.tracker.release(source));
    }
  };
  return {
    hold(componentId, source) {
      const entry = entryOf(componentId);
      entry.sources.add(source);
      changed(componentId, entry.tracker.hold(source));
    },
    release,
    releaseOwner(owner) {
      const prefix = `${owner}/`;
      for (const [componentId, entry] of [...trackers]) {
        for (const source of [...entry.sources].filter((candidate) => candidate.startsWith(prefix))) {
          release(componentId, source);
        }
      }
    },
    releaseAll() {
      for (const [componentId, entry] of [...trackers]) {
        entry.sources.clear();
        changed(componentId, entry.tracker.releaseAll());
      }
    },
    isClosed: (componentId) => trackers.get(componentId)?.closed ?? false,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

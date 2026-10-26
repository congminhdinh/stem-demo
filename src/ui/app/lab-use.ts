// N18 P2 fix round 1 (I1): whether the lab has been used yet: a pointer press, a key, or a project the host loaded. main.tsx starts
// watching before the lab renders, because the LMS sends its load-project as soon as the lab says ready, long before the robot lab's
// chunk has loaded; the host loader says when it applied one (`markUsed`). The robot lab warms its physics engine once the view is up
// and the lab was used (RobotLab.tsx): a lab that is only opened downloads none of it.

export type LabUse = {
  /** Whether the lab was used. */
  used(): boolean;
  /** Calls `listener` once the lab is used (at once if it was); returns the way to take it back. */
  onUsed(listener: () => void): () => void;
};

export type LabUseWatch = LabUse & {
  /** The lab was used another way (the host loader applied a project). */
  markUsed(): void;
  /** Stops watching the target's input. */
  dispose(): void;
};

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Watches `target` (the lab's window) for the first press or key, from now on. */
export function watchLabUse(target: Target): LabUseWatch {
  let used = false;
  const listeners = new Set<() => void>();
  const options = { capture: true } as const;
  const stop = () => {
    target.removeEventListener('pointerdown', markUsed, options);
    target.removeEventListener('keydown', markUsed, options);
  };
  function markUsed() {
    if (used) return;
    used = true;
    stop();
    for (const listener of [...listeners]) listener();
    listeners.clear();
  }
  target.addEventListener('pointerdown', markUsed, options);
  target.addEventListener('keydown', markUsed, options);
  return {
    used: () => used,
    onUsed(listener) {
      if (used) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    markUsed,
    dispose: stop,
  };
}

import { useEffect, useRef } from 'react';
import { useText } from '../i18n/text';
import type { Announcer } from './announcer';
import { checkAnnouncement, runAnnouncement, runMomentOf } from './lab-announcements';
import type { RobotCheckStore } from './robot-check-store';
import type { RobotRunStore } from './robot-run-store';

// The hooks that feed the lab's announcer (N18 R8) from its stores: what a run does, and what a check does. Each says an event once, when
// the state changes to it. The words are read when the event happens, in the learner's language.

/**
 * Tells the announcer about the run (started, paused, resumed, stopped, finished, over and why, the robot put back, teleop on or off).
 * The store changes in several steps within one call (Dừng sets the snapshot, then the flags): only where it has got to by the end of the
 * tick is looked at, so that a step on the way is never said.
 */
export function useRunAnnouncements(store: RobotRunStore, checks: RobotCheckStore | null, announcer: Announcer, maxScore: number | undefined): void {
  const t = useText();
  const words = useRef(t);
  useEffect(() => {
    words.current = t;
  });
  useEffect(() => {
    const checking = () => checks !== null && checks.getState().running !== null;
    let previous = runMomentOf(store.getState(), maxScore, checking());
    let alive = true;
    let waiting = false;
    const look = () => {
      waiting = false;
      if (!alive) return;
      const next = runMomentOf(store.getState(), maxScore, checking());
      const found = runAnnouncement(previous, next);
      previous = next;
      if (found !== null) announcer.say(words.current(found.key, found.params));
    };
    const stop = store.subscribe(() => {
      if (waiting) return;
      waiting = true;
      queueMicrotask(look);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [store, checks, announcer, maxScore]);
}

/** Tells the announcer that a check started, how each round ended and the result (R6.3's words, which the lab's one announcer now speaks). */
export function useCheckAnnouncements(checks: RobotCheckStore | null, announcer: Announcer): void {
  const t = useText();
  const words = useRef(t);
  useEffect(() => {
    words.current = t;
  });
  useEffect(() => {
    if (checks === null) return undefined;
    let previous = checkAnnouncement(checks.getState(), words.current);
    return checks.subscribe((state) => {
      const text = checkAnnouncement(state, words.current);
      if (text === previous) return;
      previous = text;
      announcer.say(text);
    });
  }, [checks, announcer]);
}

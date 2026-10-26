import { useEffect, useRef } from 'react';
import { useText } from '../i18n/text';
import type { Announcer } from './announcer';
import { objectName, type NamingScenario } from './check-report';
import { checkAnnouncement, createGripAnnouncer, gripMomentOf, runAnnouncement, runMomentOf } from './lab-announcements';
import type { RobotCheckStore } from './robot-check-store';
import type { RobotRunStore } from './robot-run-store';

// The hooks that feed the lab's announcer (N18 R8) from its stores: what a run does, and what a check does. Each says an event once, when
// the state changes to it. The words are read when the event happens, in the learner's language.

/** N19 E1: what the grip announcements need: the scenario that names the objects ("khối đỏ"), and the clock (ms) that holds them to 1.5 s. */
export type GripOptions = { scenario?: NamingScenario; now?: () => number };

/**
 * Tells the announcer about the run (started, paused, resumed, stopped, finished, over and why, the robot put back, teleop on or off, and
 * N19 E1 an object the gripper picked up or put down).
 * The store changes in several steps within one call (Dừng sets the snapshot, then the flags): only where it has got to by the end of the
 * tick is looked at, so that a step on the way is never said.
 */
export function useRunAnnouncements(store: RobotRunStore, checks: RobotCheckStore | null, announcer: Announcer, maxScore: number | undefined, grip: GripOptions = {}): void {
  const t = useText();
  const words = useRef(t);
  const gripOptions = useRef(grip);
  useEffect(() => {
    words.current = t;
    gripOptions.current = grip;
  });
  useEffect(() => {
    const checking = () => checks !== null && checks.getState().running !== null;
    const now = () => (gripOptions.current.now ?? (() => performance.now()))();
    let previous = runMomentOf(store.getState(), maxScore, checking());
    let alive = true;
    let waiting = false;
    // N19 E1: an object picked up or put down, at most one saying in GRIP_INTERVAL_MS; a change that had to wait is looked at again by a timer.
    const gripAnnouncer = createGripAnnouncer();
    let retry: ReturnType<typeof setTimeout> | null = null;
    const lookGrip = () => {
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
      if (!alive) return;
      const state = store.getState();
      const { say, retryAt } = gripAnnouncer.update(gripMomentOf(state, checking()), now());
      if (say !== null) {
        const object = objectName(words.current, gripOptions.current.scenario, say.id, state.round?.index ?? 0);
        announcer.say(words.current(say.key, { object }));
      }
      if (retryAt !== null) retry = setTimeout(lookGrip, Math.max(0, retryAt - now()));
    };
    lookGrip();
    const look = () => {
      waiting = false;
      if (!alive) return;
      const next = runMomentOf(store.getState(), maxScore, checking());
      const found = runAnnouncement(previous, next);
      previous = next;
      if (found !== null) announcer.say(words.current(found.key, found.params));
      lookGrip();
    };
    const stop = store.subscribe(() => {
      if (waiting) return;
      waiting = true;
      queueMicrotask(look);
    });
    return () => {
      alive = false;
      if (retry !== null) clearTimeout(retry);
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

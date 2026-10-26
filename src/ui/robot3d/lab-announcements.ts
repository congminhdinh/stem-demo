import type { MessageKey, Params } from '../i18n/messages';
import type { Text } from '../i18n/text';
import type { RobotCheckState } from './robot-check-store';
import { labStatus, shownScore, type LabStatus, type RobotLabState } from './robot-run-store';
import { fallbackNoteKey, type ViewFallbackReason } from './webgl-support';

// What the robot lab says politely (N18 R8), as events worked out from the state, so that it is told once when something happens and
// never while a value moves: a run started, paused, resumed, stopped, finished or over (and why, with its score when the lesson has one),
// the robot put back, teleop on or off, N19 E1 an object picked up or put down (`createGripAnnouncer`); a check started, each round's end and its result (`checkAnnouncement`, R6.3's, which
// the announcer reuses). Errors are not here: they are the assertive region's (the run's messages, a check that did not finish).

/** What the announcements read of the run store at one moment. */
export type RunMoment = {
  status: LabStatus;
  teleop: boolean;
  /** A check holds the lab: the check says what happens. */
  checking: boolean;
  /** The score shown, and the lesson's top score (null for a lesson with none). */
  points: number | null;
  maxScore: number | null;
};

/** `checking`: a check is under way (the lab is locked, or a check that has not locked it yet is stopping the learner's run). */
export function runMomentOf(state: RobotLabState, maxScore: number | undefined, checking = false): RunMoment {
  return { status: labStatus(state), teleop: state.teleop, checking: checking || state.locked, points: shownScore(state)?.points ?? null, maxScore: maxScore ?? null };
}

export type Announcement = { key: MessageKey; params?: Params };

/** The words of a run that is over, with its score when it has one. */
function ended(key: 'timeUp' | 'crashed', to: RunMoment): Announcement {
  return to.points !== null && to.maxScore !== null
    ? { key: `robot.announce.run.${key}.score`, params: { points: to.points, max: to.maxScore } }
    : { key: `robot.announce.run.${key}` };
}

/** What changing from `from` to `to` is worth saying, or null. */
export function runAnnouncement(from: RunMoment, to: RunMoment): Announcement | null {
  // A check says its own (checkAnnouncement's words); what it leaves in view when it lets go is no news.
  if (to.checking || from.checking) return null;
  const status = statusAnnouncement(from, to);
  if (from.teleop !== to.teleop) {
    // Teleop going off because a run starts is that run starting; turned on, the run it makes is not announced as one.
    if (to.teleop) return { key: 'robot.announce.teleop.on' };
    return status?.key === 'robot.announce.run.started' ? status : { key: 'robot.announce.teleop.off' };
  }
  return status;
}

function statusAnnouncement(from: RunMoment, to: RunMoment): Announcement | null {
  if (from.status === to.status) return null;
  switch (to.status) {
    case 'running':
      return { key: from.status === 'paused' ? 'robot.announce.run.resumed' : 'robot.announce.run.started' };
    case 'teleop':
    case 'starting':
    case 'error':
      return null;
    case 'paused':
      return { key: 'robot.announce.run.paused' };
    case 'finished':
      return { key: 'robot.announce.run.finished' };
    case 'stopped':
      return { key: 'robot.announce.run.stopped' };
    case 'timeUp':
    case 'crashed':
      return ended(to.status, to);
    case 'idle':
      // A start that did not happen (the program does not compile) goes back to idle: nothing was put back.
      return from.status === 'starting' ? null : { key: 'robot.announce.run.reset' };
  }
}

/**
 * What a screen reader hears of a check (N18 R6.3): that it started, how each round ended, the result. Short, and only the words that
 * change: the simulated time moving never changes them. Empty when there is no check to speak of.
 */
export function checkAnnouncement({ running, report }: Pick<RobotCheckState, 'running' | 'report' | 'failure'>, t: Text): string {
  const verdict = (passed: boolean) => t(passed ? 'robot.check.passed' : 'robot.check.failed');
  if (running !== null) {
    const last = running.ended.at(-1);
    return last === undefined
      ? t(running.speed === 'fast' ? 'robot.check.fastRunning' : 'robot.check.running')
      : t('robot.check.announce.round', { round: last.index + 1, verdict: verdict(last.passed), points: last.score });
  }
  return report === null ? '' : t('robot.check.announce.result', { verdict: verdict(report.result.passed), score: report.result.score, max: report.result.maxScore });
}

/**
 * What the view switching to or from the 2D map is worth saying: to the map the reason (the note under it, or "switched to the 2D map"
 * when the learner chose it), back to 3D that it is back; null when nothing changed.
 */
export function viewAnnouncement(before: ViewFallbackReason | null, after: ViewFallbackReason | null): MessageKey | null {
  if (before === after) return null;
  if (after === null) return 'robot.announce.view.3d';
  return fallbackNoteKey[after] ?? 'robot.announce.view.2d';
}

/** N19 E1: the least time between two sayings of a grip. */
export const GRIP_INTERVAL_MS = 1500;

/**
 * What the grip announcements read of the run store at one moment: the run's world is live (a run that goes on or is over, shown by the
 * lab: not before a run, not what a stopped run left, not while a check holds the lab or a start builds its world), the world's time, and
 * the id of the object the gripper holds (null for none, and for a robot with no gripper).
 */
export type GripMoment = { live: boolean; t: number; heldId: string | null };

/** `checking`: a check is under way (as `runMomentOf`'s): it says its own rounds, and what it shows is no grip of the learner's. */
export function gripMomentOf(state: RobotLabState, checking = false): GripMoment {
  const { snapshot } = state;
  if (checking || state.locked || state.starting || snapshot.status === 'idle' || snapshot.world === null) return { live: false, t: 0, heldId: null };
  return { live: true, t: snapshot.world.t, heldId: snapshot.world.robot.gripper?.heldId ?? null };
}

/** What a change of the held object is said as: the object's id, for the words to name it as the learner sees it ("khối đỏ"). */
export type GripSaid = { key: 'robot.announce.grip.picked' | 'robot.announce.grip.released'; id: string };

export type GripAnnouncer = {
  /**
   * The held object as it is at `moment`, at `now` (ms): `say` is what to say now, and `retryAt` when to look again (ms) when a change had to
   * wait for the end of the window. Said at most once per `GRIP_INTERVAL_MS`; a change inside the window is said when it ends if it still
   * stands (the listener hears where the grip settles, never a pair that cancel), and not at all when the grip is back as it was heard.
   * A run that begins (or whose world starts over: its time goes back), a run that is over and gone, and a check are no events: they reset
   * what was heard, silently.
   */
  update(moment: GripMoment, now: number): { say: GripSaid | null; retryAt: number | null };
};

const nothingToSay = Object.freeze({ say: null, retryAt: null });

export function createGripAnnouncer(intervalMs = GRIP_INTERVAL_MS): GripAnnouncer {
  /** What the listener has been told is held. */
  let heard: string | null = null;
  let saidAt = Number.NEGATIVE_INFINITY;
  let wasLive = false;
  let lastT = 0;
  return {
    update(moment, now) {
      if (!moment.live) {
        wasLive = false;
        heard = null;
        saidAt = Number.NEGATIVE_INFINITY;
        lastT = 0;
        return nothingToSay;
      }
      const fresh = !wasLive || moment.t < lastT;
      wasLive = true;
      lastT = moment.t;
      if (fresh) {
        heard = moment.heldId;
        saidAt = Number.NEGATIVE_INFINITY;
        return nothingToSay;
      }
      if (moment.heldId === heard) return nothingToSay;
      if (now - saidAt < intervalMs) return { say: null, retryAt: saidAt + intervalMs };
      const before = heard;
      heard = moment.heldId;
      saidAt = now;
      return { say: moment.heldId === null ? { key: 'robot.announce.grip.released', id: before! } : { key: 'robot.announce.grip.picked', id: moment.heldId }, retryAt: null };
    },
  };
}

import { describe, expect, it } from 'vitest';
import { checkAnnouncement, runAnnouncement, viewAnnouncement, type RunMoment } from './lab-announcements';
import type { RobotCheckState } from './robot-check-store';
import type { LabStatus } from './robot-run-store';

// N18 R8: what the lab says politely about a run, as events: a run started, paused, resumed, stopped, finished, over (and why), a robot
// put back, teleop on or off. Never a value that changes while it runs. During a check the check's own announcements speak (checkAnnouncement).

const moment = (status: LabStatus, rest: Partial<RunMoment> = {}): RunMoment => ({ status, teleop: false, checking: false, points: null, maxScore: null, ...rest });
const said = (from: RunMoment, to: RunMoment) => runAnnouncement(from, to);

describe('runAnnouncement', () => {
  it('says nothing for a start that did not happen: the lab goes back to idle with nothing put back', () => {
    expect(said(moment('starting'), moment('idle'))).toBeNull();
    expect(said(moment('starting', { teleop: true }), moment('idle'))).toEqual({ key: 'robot.announce.teleop.off' });
  });

  it('says nothing while nothing changes, however the numbers of a run move', () => {
    expect(said(moment('running', { points: 10, maxScore: 100 }), moment('running', { points: 40, maxScore: 100 }))).toBeNull();
    expect(said(moment('idle'), moment('idle'))).toBeNull();
    expect(said(moment('timeUp', { points: 10, maxScore: 100 }), moment('timeUp', { points: 10, maxScore: 100 }))).toBeNull();
  });

  it('says a run started once it is going, not while its world is built', () => {
    expect(said(moment('idle'), moment('starting'))).toBeNull();
    expect(said(moment('starting'), moment('running'))).toEqual({ key: 'robot.announce.run.started' });
    expect(said(moment('stopped'), moment('running'))).toEqual({ key: 'robot.announce.run.started' });
    expect(said(moment('timeUp'), moment('starting'))).toBeNull();
  });

  it('says paused and resumed', () => {
    expect(said(moment('running'), moment('paused'))).toEqual({ key: 'robot.announce.run.paused' });
    expect(said(moment('paused'), moment('running'))).toEqual({ key: 'robot.announce.run.resumed' });
  });

  it('says a run the learner stopped, a program that finished, and a robot put back', () => {
    expect(said(moment('running'), moment('stopped'))).toEqual({ key: 'robot.announce.run.stopped' });
    expect(said(moment('running'), moment('finished'))).toEqual({ key: 'robot.announce.run.finished' });
    expect(said(moment('stopped'), moment('idle'))).toEqual({ key: 'robot.announce.run.reset' });
    expect(said(moment('timeUp'), moment('idle'))).toEqual({ key: 'robot.announce.run.reset' });
  });

  it('says how a run ended, and its score when the lesson has one', () => {
    expect(said(moment('running'), moment('timeUp'))).toEqual({ key: 'robot.announce.run.timeUp' });
    expect(said(moment('running'), moment('crashed'))).toEqual({ key: 'robot.announce.run.crashed' });
    expect(said(moment('finished'), moment('timeUp', { points: 80, maxScore: 100 }))).toEqual({ key: 'robot.announce.run.timeUp.score', params: { points: 80, max: 100 } });
    expect(said(moment('running'), moment('crashed', { points: 0, maxScore: 100 }))).toEqual({ key: 'robot.announce.run.crashed.score', params: { points: 0, max: 100 } });
  });

  it('leaves an error to the assertive region, which says what it was', () => {
    expect(said(moment('running'), moment('error'))).toBeNull();
    expect(said(moment('starting'), moment('error'))).toBeNull();
  });

  it('says teleop on and off, and a run it started is not announced as one', () => {
    expect(said(moment('idle'), moment('starting', { teleop: true }))).toEqual({ key: 'robot.announce.teleop.on' });
    expect(said(moment('starting', { teleop: true }), moment('teleop', { teleop: true }))).toBeNull();
    expect(said(moment('teleop', { teleop: true }), moment('stopped'))).toEqual({ key: 'robot.announce.teleop.off' });
    // A Run that ends teleop starts a run: that is what is said.
    expect(said(moment('teleop', { teleop: true }), moment('running'))).toEqual({ key: 'robot.announce.run.started' });
  });

  it('says how a teleop run ended', () => {
    expect(said(moment('teleop', { teleop: true }), moment('crashed', { teleop: true }))).toEqual({ key: 'robot.announce.run.crashed' });
    expect(said(moment('teleop', { teleop: true }), moment('timeUp', { teleop: true }))).toEqual({ key: 'robot.announce.run.timeUp' });
  });

  it('is silent while a check holds the lab: the check says what happens', () => {
    expect(said(moment('idle'), moment('running', { checking: true }))).toBeNull();
    expect(said(moment('running', { checking: true }), moment('timeUp', { checking: true }))).toBeNull();
    // And the moment it lets go, with the round it left in view, is no news either.
    expect(said(moment('timeUp', { checking: true }), moment('timeUp'))).toBeNull();
    expect(said(moment('running', { checking: true }), moment('stopped'))).toBeNull();
  });
});

const idleCheck = { running: null, report: null, failure: null } as unknown as Pick<RobotCheckState, 'running' | 'report' | 'failure'>;
const t = (key: string, params: Record<string, string | number> = {}) => `${key}${Object.keys(params).length ? JSON.stringify(params) : ''}`;

describe('checkAnnouncement', () => {
  it('says nothing before a check, and what is said of a check only when it starts, when a round ends and with the result', () => {
    expect(checkAnnouncement(idleCheck, t as never)).toBe('');
    const running = (speed: string, ended: { index: number; passed: boolean; score: number }[], tS = 5) => ({ ...idleCheck, running: { speed, index: ended.length, count: 3, tS, timeLimitS: 20, ended } }) as never;
    expect(checkAnnouncement(running('fast', []), t as never)).toBe('robot.check.fastRunning');
    expect(checkAnnouncement(running('1x', []), t as never)).toBe('robot.check.running');
    // The time moving does not change what is said.
    expect(checkAnnouncement(running('1x', [], 9), t as never)).toBe('robot.check.running');
    expect(checkAnnouncement(running('4x', [{ index: 1, passed: true, score: 100 }]), t as never)).toBe('robot.check.announce.round{"round":2,"verdict":"robot.check.passed","points":100}');
    const reported = { ...idleCheck, report: { result: { passed: false, score: 30, maxScore: 100 } } } as never;
    expect(checkAnnouncement(reported, t as never)).toBe('robot.check.announce.result{"verdict":"robot.check.failed","score":30,"max":100}');
  });
});

describe('viewAnnouncement', () => {
  it('says why the 2D map stands in for 3D, that the learner chose it, and that 3D is back', () => {
    expect(viewAnnouncement(null, 'no-webgl')).toBe('robot.topview.noWebgl');
    expect(viewAnnouncement(null, 'context-lost')).toBe('robot.topview.contextLost');
    expect(viewAnnouncement(null, 'canvas-failed')).toBe('robot.topview.canvasFailed');
    expect(viewAnnouncement(null, 'chosen')).toBe('robot.announce.view.2d');
    expect(viewAnnouncement('chosen', null)).toBe('robot.announce.view.3d');
    expect(viewAnnouncement('context-lost', null)).toBe('robot.announce.view.3d');
  });

  it('says nothing while the view stays as it is, and the new reason when the 2D map changes its cause', () => {
    expect(viewAnnouncement(null, null)).toBeNull();
    expect(viewAnnouncement('chosen', 'chosen')).toBeNull();
    expect(viewAnnouncement('no-webgl', 'chosen')).toBe('robot.announce.view.2d');
  });
});

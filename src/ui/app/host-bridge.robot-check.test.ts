import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { ROBOT_ENGINE, type RobotCheckResult } from '../../core/scenario/check-result';
import {
  createHostBridge,
  LAB_PROTOCOL,
  PROJECT_CHANGED_DEBOUNCE_MS,
  robotCheckResult,
  RobotMessageError,
  type LabWindow,
} from './host-bridge';

// N18 R7.1 (plan §4.7): the robot lab's check-result with its score, the order of its messages, and what the bridge refuses to send.
// The shapes themselves are the shared fixture's (host-bridge.fixture.test.ts); this is the behaviour around them.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const hostOrigin = 'http://localhost:3000';
const goals = [
  { id: 'stop-in-zone', label: 'Dừng trong vùng đích' },
  { id: 'avoid-wall', label: 'Không chạm tường' },
];

function setup(lab?: 'robot') {
  const posted: [Record<string, unknown>, string][] = [];
  const host = { postMessage: (message: unknown, targetOrigin: string) => void posted.push([message as Record<string, unknown>, targetOrigin]) };
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const window = {
    addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: (event: unknown) => void) => void listeners.get(type)?.delete(listener),
  } as unknown as LabWindow;
  const bridge = createHostBridge({ host, hostOrigin, window, onLoadProject: () => {}, ...(lab === undefined ? {} : { lab }) });
  const fire = (type: string, event: object = {}) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
  return { bridge, posted, fire, types: () => posted.map(([message]) => message.type) };
}

/** A robot lab that has said ready for a scenario with two goals, as `rb-stop-at-wall` will. */
function readyRobot() {
  const lab = setup('robot');
  lab.bridge.ready({ template: 'rb-stop-at-wall', profile: 'uno-basic', goals, robot: { scenarioVersion: 1, maxScore: 100 } });
  lab.posted.length = 0;
  return lab;
}

const check = (): RobotCheckResult => ({
  passed: true,
  goals: [
    { id: 'stop-in-zone', label: 'Dừng trong vùng đích', passed: true },
    { id: 'avoid-wall', label: 'Không chạm tường', passed: true },
  ],
  score: 86.5,
  maxScore: 100,
  simTimeMs: 12400,
  variants: [
    { seed: 7, passed: true, score: 88, simTimeMs: 12100 },
    { seed: 1031, passed: true, score: 86, simTimeMs: 12500 },
    { seed: 52817, passed: true, score: 85.5, simTimeMs: 12600 },
  ],
  engine: ROBOT_ENGINE,
  scenarioVersion: 1,
  programHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
});

describe('robotCheckResult, the builder of a robot check-result message', () => {
  it('says the protocol, the type and lab: robot, then the verdict, the goals and the robot fields, in that order', () => {
    const message = robotCheckResult(check());
    expect(Object.keys(message)).toEqual(['protocol', 'type', 'lab', 'passed', 'goals', 'score', 'maxScore', 'simTimeMs', 'variants', 'engine', 'scenarioVersion', 'programHash']);
    expect(message.protocol).toBe(LAB_PROTOCOL);
    expect(message.lab).toBe('robot');
    expect(Object.keys(message.goals[0] ?? {})).toEqual(['id', 'label', 'passed']);
    expect(Object.keys(message.variants[0] ?? {})).toEqual(['seed', 'passed', 'score', 'simTimeMs']);
  });

  it('sends only the fields the host reads, whatever else the result carries', () => {
    const rich = check() as unknown as Record<string, unknown>;
    rich.replay = { frames: 3 };
    (rich.variants as Record<string, unknown>[])[0]!.failure = 'Xe chạm tường lúc 12,4 s';
    (rich.goals as Record<string, unknown>[])[0]!.reasonKey = 'robot-did-not-move';
    const message = robotCheckResult(rich as unknown as RobotCheckResult);
    expect(message).toEqual(robotCheckResult(check()));
    expect(JSON.stringify(message)).not.toMatch(/replay|failure|reasonKey/);
  });

  it('copies the lists: a result changed afterwards does not change the message', () => {
    const input = check();
    const message = robotCheckResult(input);
    (input.variants as unknown as { score: number }[])[0]!.score = 0;
    (input.goals as unknown as { passed: boolean }[])[0]!.passed = false;
    expect(message.variants[0]?.score).toBe(88);
    expect(message.goals[0]?.passed).toBe(true);
  });

  it('throws a RobotMessageError that names every field out of its bounds, instead of building a message the host would drop', () => {
    const broken = { ...check(), score: 100.5, programHash: 'not hex', variants: [] } as RobotCheckResult;
    expect(() => robotCheckResult(broken)).toThrow(RobotMessageError);
    expect(() => robotCheckResult(broken)).toThrow(/score: must be a finite number from 0 to 100; programHash: must be 1 to 64 hexadecimal digits/);
    try {
      robotCheckResult(broken);
    } catch (error) {
      expect((error as RobotMessageError).problems).toEqual(['score: must be a finite number from 0 to 100', 'programHash: must be 1 to 64 hexadecimal digits']);
    }
  });

  it.each([
    ['a score of NaN', { score: NaN }],
    ['a score above 100', { score: 101 }],
    ['a maxScore of 90', { maxScore: 90 }],
    ['11 variants', { variants: Array.from({ length: 11 }, (_, seed) => ({ seed, passed: true, score: 86.5, simTimeMs: 1 })) }],
    ['no programHash', { programHash: undefined }],
    ['no variants', { variants: undefined }],
    ['an engine with a space', { engine: 'robot engine' }],
    ['scenarioVersion 0', { scenarioVersion: 0 }],
  ])('refuses %s', (_, change) => {
    expect(() => robotCheckResult({ ...check(), ...change } as unknown as RobotCheckResult)).toThrow(RobotMessageError);
  });
});

describe('the robot bridge’s check-result (N18 R7.1)', () => {
  it('posts a scored check to the host origin only, with lab: robot and the robot fields', () => {
    const { bridge, posted } = readyRobot();
    bridge.robotCheckResult(check());
    expect(posted).toEqual([[{ protocol: LAB_PROTOCOL, type: 'check-result', lab: 'robot', ...check(), goals: check().goals.map((goal) => ({ ...goal })) }, hostOrigin]]);
    expect(posted.map(([, origin]) => origin)).not.toContain('*');
  });

  it('lists exactly the goals of ready, in its order: anything else is refused and nothing is posted', () => {
    const { bridge, posted } = readyRobot();
    const [first, second] = check().goals as [RobotCheckResult['goals'][number], RobotCheckResult['goals'][number]];
    const wrong: Record<string, RobotCheckResult['goals']> = {
      'in another order': [second, first],
      'with a goal missing': [first],
      'with a goal more': [first, second, { id: 'extra', label: 'Thêm', passed: true }],
      'with another id': [first, { ...second, id: 'avoid-walls' }],
      'with no goals': [],
    };
    for (const [how, list] of Object.entries(wrong)) {
      expect(() => bridge.robotCheckResult({ ...check(), goals: list }), how).toThrow(RobotMessageError);
    }
    expect(() => bridge.robotCheckResult({ ...check(), goals: [second, first] })).toThrow(/goals: must list the goals of ready \(stop-in-zone, avoid-wall\) in its order, not \(avoid-wall, stop-in-zone\)/);
    expect(posted).toEqual([]);
  });

  it('keeps the goal labels of the result: only the ids are held to ready', () => {
    const { bridge, posted } = readyRobot();
    bridge.robotCheckResult({ ...check(), goals: check().goals.map((goal) => ({ ...goal, label: `${goal.label} (đã chấm)` })) });
    expect((posted[0]?.[0].goals as { label: string }[]).map((goal) => goal.label)).toEqual(['Dừng trong vùng đích (đã chấm)', 'Không chạm tường (đã chấm)']);
  });

  it('refuses a result of another scenario version than ready announced', () => {
    const { bridge, posted } = readyRobot();
    expect(() => bridge.robotCheckResult({ ...check(), scenarioVersion: 2 })).toThrow(/scenarioVersion: ready said 1, the check says 2/);
    expect(posted).toEqual([]);
  });

  it('takes any version when ready announced none', () => {
    const { bridge, posted } = setup('robot');
    bridge.ready({ template: 'rb-stop-at-wall', profile: 'uno-basic', goals });
    bridge.robotCheckResult({ ...check(), scenarioVersion: 7 });
    expect(posted.map(([message]) => message.type)).toEqual(['ready', 'check-result']);
  });

  it('refuses a result before ready: the host reads a check against the goals of its load’s ready', () => {
    const { bridge, posted } = setup('robot');
    expect(() => bridge.robotCheckResult(check())).toThrow(/before ready/);
    expect(posted).toEqual([]);
  });

  it('refuses a result with a field out of its bounds, with nothing posted and nothing flushed', () => {
    const { bridge, posted } = readyRobot();
    bridge.projectChanged(createNewProject('a'));
    expect(() => bridge.robotCheckResult({ ...check(), score: 120 })).toThrow(RobotMessageError);
    expect(posted).toEqual([]);
  });

  it('is for the robot lab alone: a Blockly or Yolo:Bit bridge refuses to send robot fields', () => {
    const { bridge, posted } = setup();
    bridge.ready({ template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'g', label: 'Trái tim' }] });
    expect(() => bridge.robotCheckResult(check())).toThrow(/Only the robot lab/);
    expect(posted).toHaveLength(1);
  });

  describe('the plain check-result, which a robot lab sends for the sandbox', () => {
    it('is {passed, goals: []} with lab: robot when ready listed no goals', () => {
      const { bridge, posted } = setup('robot');
      bridge.ready({ template: 'rb-sandbox', profile: 'uno-basic', goals: [], robot: { scenarioVersion: 1 } });
      bridge.checkResult({ passed: true, goals: [] });
      expect(posted[1]?.[0]).toEqual({ protocol: LAB_PROTOCOL, type: 'check-result', lab: 'robot', passed: true, goals: [] });
    });

    it('is refused for a scenario with goals, which needs the score: use robotCheckResult', () => {
      const { bridge, posted } = readyRobot();
      expect(() => bridge.checkResult({ passed: true, goals: check().goals.map((goal) => ({ ...goal })) })).toThrow(/robotCheckResult/);
      expect(() => bridge.checkResult({ passed: true, goals: [] })).toThrow(RobotMessageError);
      expect(posted).toEqual([]);
    });

    it('is refused with goals when ready listed none', () => {
      const { bridge, posted } = setup('robot');
      bridge.ready({ template: 'rb-sandbox', profile: 'uno-basic', goals: [], robot: { scenarioVersion: 1 } });
      posted.length = 0;
      expect(() => bridge.checkResult({ passed: true, goals: [{ id: 'g', label: 'Mục tiêu', passed: true }] })).toThrow(RobotMessageError);
      expect(posted).toEqual([]);
    });
  });
});

describe('the order of a robot lab’s messages (N18 R7.1)', () => {
  const lastDocument = createNewProject('the program that is checked');

  it('flushes a pending project-changed before a check-result, so the last one is the checked program', () => {
    const { bridge, posted, types } = readyRobot();
    bridge.projectChanged(createNewProject('an earlier edit'));
    bridge.projectChanged(lastDocument);
    bridge.robotCheckResult(check());

    expect(types()).toEqual(['project-changed', 'check-result']);
    expect(posted[0]?.[0]).toEqual({ protocol: LAB_PROTOCOL, type: 'project-changed', lab: 'robot', document: lastDocument });
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 3);
    expect(types()).toEqual(['project-changed', 'check-result']);
  });

  it('does the same before the plain check-result of the sandbox', () => {
    const { bridge, types, posted } = setup('robot');
    bridge.ready({ template: 'rb-sandbox', profile: 'uno-basic', goals: [], robot: { scenarioVersion: 1 } });
    posted.length = 0;
    bridge.projectChanged(lastDocument);
    bridge.checkResult({ passed: true, goals: [] });
    expect(types()).toEqual(['project-changed', 'check-result']);
  });

  it('sends nothing extra before a check-result when no project-changed is pending', () => {
    const { bridge, types } = readyRobot();
    bridge.robotCheckResult(check());
    expect(types()).toEqual(['check-result']);
  });

  it('sends the pending project-changed when the check begins, and none while it runs, however long it takes', () => {
    const { bridge, posted, types } = readyRobot();
    bridge.projectChanged(lastDocument);
    bridge.beginCheck();
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(lastDocument);

    bridge.projectChanged(createNewProject('an edit that sneaked in during the check'));
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual(['project-changed']);
  });

  it('keeps the whole order of a check: the checked program, run-started, run-stopped, check-result; the last project-changed before it is the checked one', () => {
    const { bridge, posted, types } = readyRobot();
    bridge.projectChanged(createNewProject('first draft'));
    bridge.projectChanged(lastDocument);
    bridge.beginCheck();
    bridge.runStarted();
    bridge.projectChanged(createNewProject('during the check'));
    bridge.runStopped();
    bridge.robotCheckResult(check());
    bridge.endCheck();

    expect(types()).toEqual(['project-changed', 'run-started', 'run-stopped', 'check-result']);
    const lastProject = posted.map(([message]) => message).filter((message) => message.type === 'project-changed').at(-1);
    expect(lastProject?.document).toBe(lastDocument);
  });

  it('sends an edit made during a check once, after the check-result', () => {
    const { bridge, posted, types } = readyRobot();
    const sneaked = createNewProject('an edit during the check');
    bridge.projectChanged(lastDocument);
    bridge.beginCheck();
    bridge.runStarted();
    bridge.projectChanged(sneaked);
    bridge.runStopped();
    bridge.robotCheckResult(check());
    bridge.endCheck();
    expect(types()).toEqual(['project-changed', 'run-started', 'run-stopped', 'check-result']);

    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS - 1);
    expect(types()).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(types()).toEqual(['project-changed', 'run-started', 'run-stopped', 'check-result', 'project-changed']);
    expect(posted.at(-1)?.[0].document).toBe(sneaked);
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toHaveLength(5);
  });

  it('keeps only the latest edit made during a check', () => {
    const { bridge, posted, types } = readyRobot();
    const latest = createNewProject('the latest');
    bridge.beginCheck();
    bridge.projectChanged(createNewProject('first'));
    bridge.projectChanged(createNewProject('second'));
    bridge.projectChanged(latest);
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(latest);
  });

  it('lets an edit made after the check supersede the one kept during it, as any later edit does', () => {
    const { bridge, posted, types } = readyRobot();
    const after = createNewProject('after the check');
    bridge.beginCheck();
    bridge.projectChanged(createNewProject('during'));
    bridge.endCheck();
    bridge.projectChanged(after);
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(after);
  });

  it('never sends the kept edit with the check-result: robotCheckResult flushes what is pending, not what waits for endCheck', () => {
    const { bridge, types } = readyRobot();
    bridge.beginCheck();
    bridge.projectChanged(createNewProject('during'));
    bridge.robotCheckResult(check());
    expect(types()).toEqual(['check-result']);
    bridge.endCheck();
    expect(types()).toEqual(['check-result']);
  });

  it('sends the kept edit when the page goes away during a check, so that nothing stays behind', () => {
    const { bridge, posted, types, fire } = readyRobot();
    const sneaked = createNewProject('an edit during the check');
    bridge.beginCheck();
    bridge.projectChanged(sneaked);
    expect(types()).toEqual([]);
    fire('pagehide');
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(sneaked);
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual(['project-changed']);
  });

  it('keeps the edit made during a check for endCheck when the page goes into the back/forward cache (pagehide persisted), and sends it once then', () => {
    const { bridge, posted, types, fire } = readyRobot();
    const sneaked = createNewProject('an edit during the check');
    bridge.beginCheck();
    bridge.projectChanged(sneaked);
    fire('pagehide', { persisted: true });
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual([]);

    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(sneaked);
  });

  it('still sends a pending project-changed on any pagehide, persisted or not: only the edit kept during a check waits', () => {
    for (const persisted of [true, false]) {
      const { bridge, posted, types, fire } = readyRobot();
      const pending = createNewProject(`pending (persisted ${persisted})`);
      bridge.projectChanged(pending);
      fire('pagehide', { persisted });
      expect(types()).toEqual(['project-changed']);
      expect(posted[0]?.[0].document).toBe(pending);
    }
  });

  it('sends the edit kept during a check on pagehide when the page is not persisted (it is going away), once', () => {
    const { bridge, posted, types, fire } = readyRobot();
    const sneaked = createNewProject('an edit during the check');
    bridge.beginCheck();
    bridge.projectChanged(sneaked);
    fire('pagehide', { persisted: false });
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(sneaked);
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual(['project-changed']);
  });

  it('drops the kept edit with the bridge: nothing is sent after dispose', () => {
    const { bridge, types } = readyRobot();
    bridge.beginCheck();
    bridge.projectChanged(createNewProject('during'));
    bridge.dispose();
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual([]);
  });

  it('reports edits again once the check has ended, and a cancelled check ends too', () => {
    const { bridge, types } = readyRobot();
    bridge.beginCheck();
    bridge.runStarted();
    bridge.runStopped();
    bridge.endCheck();
    const edit = createNewProject('after the check');
    bridge.projectChanged(edit);
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);
    expect(types()).toEqual(['run-started', 'run-stopped', 'project-changed']);
  });

  it('refuses a second beginCheck while a check is running, a bug of the lab, and the edit kept before it is sent once after endCheck', () => {
    const { bridge, posted, types } = readyRobot();
    const kept = createNewProject('kept before the nested beginCheck');
    bridge.beginCheck();
    bridge.projectChanged(kept);
    expect(() => bridge.beginCheck()).toThrow(/beginCheck\(\) was called while a robot check is running/);

    // The check goes on, locked: the throw neither ended it nor lost the kept edit
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual([]);
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS - 1);
    expect(types()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(kept);
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual(['project-changed']);

    // After endCheck a new check may begin
    expect(() => bridge.beginCheck()).not.toThrow();
  });

  it('keeps the latest edit made after a refused beginCheck, too', () => {
    const { bridge, posted, types } = readyRobot();
    const latest = createNewProject('after the nested beginCheck');
    bridge.beginCheck();
    bridge.projectChanged(createNewProject('before'));
    expect(() => bridge.beginCheck()).toThrow();
    bridge.projectChanged(latest);
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS * 5);
    expect(types()).toEqual(['project-changed']);
    expect(posted[0]?.[0].document).toBe(latest);
  });

  it('has endCheck do nothing without a matching beginCheck, and a second endCheck do nothing', () => {
    const { bridge, types } = readyRobot();
    bridge.endCheck();
    bridge.projectChanged(createNewProject('x'));
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);
    expect(types()).toEqual(['project-changed']);

    bridge.beginCheck();
    bridge.projectChanged(createNewProject('y'));
    bridge.endCheck();
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);
    expect(types()).toEqual(['project-changed', 'project-changed']);
  });

  it('leaves a Blockly or Yolo:Bit lab exactly as it was: no flush before its check-result, and beginCheck and endCheck change nothing', () => {
    const { bridge, posted } = setup();
    const edit = createNewProject('p');
    bridge.ready({ template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'g', label: 'Trái tim' }] });
    bridge.projectChanged(edit);
    bridge.beginCheck();
    expect(() => bridge.beginCheck()).not.toThrow();
    bridge.runStarted();
    bridge.runStopped();
    bridge.checkResult({ passed: true, goals: [{ id: 'g', label: 'Trái tim', passed: true }] });
    bridge.endCheck();
    vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);

    expect(posted.map(([message]) => JSON.stringify(message))).toEqual([
      '{"protocol":"stem-lab/v1","type":"ready","template":"ybc-heart","profile":"ybc-basic","goals":[{"id":"g","label":"Trái tim"}]}',
      '{"protocol":"stem-lab/v1","type":"run-started"}',
      '{"protocol":"stem-lab/v1","type":"run-stopped"}',
      '{"protocol":"stem-lab/v1","type":"check-result","passed":true,"goals":[{"id":"g","label":"Trái tim","passed":true}]}',
      `{"protocol":"stem-lab/v1","type":"project-changed","document":${JSON.stringify(edit)}}`,
    ]);
  });
});

describe('the robot fields of ready are held to the host’s bounds (N18 R7.1)', () => {
  it.each([
    ['scenarioVersion 0', { scenarioVersion: 0, maxScore: 100 }, goals],
    ['a fractional scenarioVersion', { scenarioVersion: 1.5, maxScore: 100 }, goals],
    ['a maxScore of 90', { scenarioVersion: 1, maxScore: 90 }, goals],
    ['a goal without a label', { scenarioVersion: 1, maxScore: 100 }, [{ id: 'stop-in-zone', label: '' }]],
    ['a goal label of 201 characters', { scenarioVersion: 1, maxScore: 100 }, [{ id: 'g', label: 'x'.repeat(201) }]],
    ['51 goals', { scenarioVersion: 1, maxScore: 100 }, Array.from({ length: 51 }, (_, index) => ({ id: `g${index}`, label: 'g' }))],
  ])('refuses a robot ready with %s, and posts nothing', (_, robot, list) => {
    const { bridge, posted } = setup('robot');
    expect(() => bridge.ready({ template: 'rb-stop-at-wall', profile: 'uno-basic', goals: list, robot })).toThrow(RobotMessageError);
    expect(posted).toEqual([]);
  });

  it('is unchanged for a Blockly or Yolo:Bit lab, which has no such bounds to hold (its labels are cut to what the host takes)', () => {
    const { bridge, posted } = setup();
    bridge.ready({ template: 'blink', profile: null, goals: [{ id: 'g', label: 'x'.repeat(250) }], robot: { scenarioVersion: 0 } });
    expect(posted).toHaveLength(1);
    expect((posted[0]?.[0].goals as { label: string }[])[0]?.label).toBe('x'.repeat(200));
  });
});

import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/all-goals.scenario.json';
import { goalKinds, inputsDueBetween, loadScenario, runEndingContact, scenarioMaxScore, SCENARIO_MAX_SCORE, type Scenario } from './scenario';
import { ScenarioError } from './scenario-schema';
import type { RobotTemplateKey } from '../../samples/robot-keys';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authored = (): any => structuredClone(fixture);

/** The fixture with its inputs replaced. */
const withInputs = (inputs: object[], timeLimitS = 60): Scenario => {
  const scenario = authored();
  scenario.inputs = inputs;
  scenario.timeLimitS = timeLimitS;
  return loadScenario(scenario);
};

describe('loadScenario', () => {
  it('loads the fixture, which has every kind of goal', () => {
    const scenario = loadScenario(fixture);
    const key: RobotTemplateKey = scenario.key; // the schema narrows the key to the seven the robot lab has
    expect(key).toBe('rb-mini-mission');
    expect(scenario.version).toBe(1);
    expect(scenario.goals.map((goal) => goal.kind)).toEqual([...goalKinds]);
    expect(scenario.start).toEqual({ xCm: 30, yCm: 40, yawDeg: 0 });
    expect(scenario.variants).toEqual({ count: 3, seed: 2026, startJitterCm: 4, yawJitterDeg: 10, obstacleJitterCm: 5 });
    expect(scenario.toolbox).toEqual(['controls_repeat_ext', 'controls_if', 'math_number']);
    expect(scenario.starter).toEqual({ blocks: { languageVersion: 0, blocks: [] } });
  });

  it('fills the arena defaults and does not touch its input', () => {
    const input = authored();
    const before = structuredClone(input);
    const scenario = loadScenario(input);
    expect(input).toEqual(before);
    expect(scenario.arena.walls[0]).toEqual({ fromCm: [0, 1], toCm: [200, 1], thicknessCm: 2, heightCm: 10, tags: [], ultrasonic: true });
  });

  it('fills a missing list of inputs and a missing scoring with nothing', () => {
    const input = authored();
    delete input.inputs;
    delete input.scoring;
    input.goals[8].points = 20; // the 10 points the time bonus gave
    const scenario = loadScenario(input);
    expect(scenario.inputs).toEqual([]);
    expect(scenario.scoring).toEqual({});
  });

  it('loads a JSON text the same as the value', () => {
    expect(loadScenario(JSON.parse(JSON.stringify(fixture)))).toEqual(loadScenario(fixture));
  });

  it('throws a ScenarioError that has the issues with their paths', () => {
    const input = authored();
    input.goals[1].zones = ['cp-a', 'cp-x'];
    let thrown: unknown;
    try {
      loadScenario(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ScenarioError);
    expect((thrown as ScenarioError).issues).toEqual([{ path: 'goals[1].zones[1]', message: 'no zone "cp-x" in the arena (zones: start, cp-a, cp-b, dock, gate)' }]);
  });
});

describe('maxScore', () => {
  it('is the goal points plus the time bonus, and 100 for every scored scenario', () => {
    const scenario = loadScenario(fixture);
    expect(scenario.goals.reduce((sum, goal) => sum + goal.points, 0)).toBe(90);
    expect(scenarioMaxScore(scenario)).toBe(100);
    expect(SCENARIO_MAX_SCORE).toBe(100);
  });

  it('is undefined for the sandbox, which has no score', () => {
    const input = authored();
    input.key = 'rb-sandbox';
    input.goals = [];
    input.scoring = {};
    delete input.toolbox;
    expect(scenarioMaxScore(loadScenario(input))).toBeUndefined();
  });
});

describe('inputs', () => {
  it('are sorted by time, whatever order they were written in', () => {
    const scenario = withInputs([
      { atS: 9, role: 'button1', action: 'release' },
      { atS: 3, role: 'button1', action: 'release' },
      { atS: 5, role: 'button1', action: 'press' },
      { atS: 1, role: 'button1', action: 'press' },
    ]);
    expect(scenario.inputs.map((input) => [input.atS, input.action])).toEqual([
      [1, 'press'],
      [3, 'release'],
      [5, 'press'],
      [9, 'release'],
    ]);
  });

  it('are normalised: only atS, role and action stay, in that shape', () => {
    expect(withInputs([{ atS: 2, role: 'button1', action: 'press' }]).inputs).toEqual([{ atS: 2, role: 'button1', action: 'press' }]);
  });
});

describe('inputsDueBetween', () => {
  const scenario = withInputs([
    { atS: 0, role: 'button1', action: 'press' },
    { atS: 0.5, role: 'button1', action: 'release' },
    { atS: 2, role: 'button1', action: 'press' },
    { atS: 2.25, role: 'button1', action: 'release' },
    { atS: 59.5, role: 'button1', action: 'press' },
  ]);

  it('gives the inputs from t0 (included) to t1 (not included), in time order', () => {
    expect(inputsDueBetween(scenario, 0, 0.5).map((input) => input.atS)).toEqual([0]);
    expect(inputsDueBetween(scenario, 0.5, 2).map((input) => input.atS)).toEqual([0.5]);
    expect(inputsDueBetween(scenario, 0, 60).map((input) => input.atS)).toEqual([0, 0.5, 2, 2.25, 59.5]);
    expect(inputsDueBetween(scenario, 2.25, 59.5).map((input) => input.atS)).toEqual([2.25]);
    expect(inputsDueBetween(scenario, 3, 59)).toEqual([]);
  });

  it('gives nothing for an empty window, and refuses a backwards or non-finite one', () => {
    expect(inputsDueBetween(scenario, 2, 2)).toEqual([]);
    expect(() => inputsDueBetween(scenario, 3, 2)).toThrow(RangeError);
    expect(() => inputsDueBetween(scenario, Number.NaN, 2)).toThrow(RangeError);
    expect(() => inputsDueBetween(scenario, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('gives a scenario without inputs nothing', () => {
    const input = authored();
    delete input.inputs;
    expect(inputsDueBetween(loadScenario(input), 0, 60)).toEqual([]);
  });
});

// "Inputs are applied at atS in every mode": real time steps by a frame, the headless check by a whole tick batch, speed 4× by
// four ticks at a time. The scenario hands out each input in exactly one window of any partition of the run, so no mode gets
// one twice or loses one, and an input is never handed out before its atS.
describe('inputs are applied at atS in every mode', () => {
  const scenario = withInputs([
    { atS: 0, role: 'button1', action: 'press' },
    { atS: 0.5, role: 'button1', action: 'release' },
    { atS: 2, role: 'button1', action: 'press' },
    { atS: 2.25, role: 'button1', action: 'release' },
    { atS: 59.5, role: 'button1', action: 'press' },
  ]);

  const windowsOf = (stepS: number, endS: number): [number, number][] => {
    const windows: [number, number][] = [];
    for (let k = 0; k * stepS < endS; k++) {
      windows.push([k * stepS, Math.min((k + 1) * stepS, endS)]);
    }
    return windows;
  };

  it.each([
    ['a 120 Hz tick', 1 / 120],
    ['a 60 fps frame at 1× (16.7 ms)', 1000 / 60 / 1000],
    ['a 60 fps frame at 4× (66.7 ms)', 4 * (1000 / 60 / 1000)],
    ['a headless batch of 250 ms', 0.25],
    ['a headless batch of 7.3 s', 7.3],
    ['one window for the whole run', 60],
  ])('hands each input out exactly once, at its own time, with %s', (_name, stepS) => {
    const handedOut: { atS: number; window: [number, number] }[] = [];
    for (const window of windowsOf(stepS, 60)) {
      for (const input of inputsDueBetween(scenario, window[0], window[1])) {
        handedOut.push({ atS: input.atS, window });
      }
    }
    expect(handedOut.map((item) => item.atS)).toEqual(scenario.inputs.map((input) => input.atS));
    for (const { atS, window } of handedOut) {
      expect(window[0]).toBeLessThanOrEqual(atS);
      expect(atS).toBeLessThan(window[1]);
    }
  });
});

// N18 R5.2a fix round 2 (controller ruling): the run ends at the first contact with a collider that has one of `endOnContact`'s tags. The
// run session and the check (R3.6, R6.2) stop there; this is the one test they share of which contact it is.
describe('runEndingContact', () => {
  const scenario = { endOnContact: ['wall', 'obstacle'] };
  const wall = { otherId: '#wall-0', tags: ['wall'] };
  const cone = { otherId: 'cone-1', tags: ['box', 'obstacle'] };
  const crate = { otherId: 'crate', tags: ['object', 'pushable'] };

  it('names the first tag of the list that a contact of the tick has, or null', () => {
    expect(runEndingContact(scenario, [crate])).toBeNull();
    expect(runEndingContact(scenario, [])).toBeNull();
    expect(runEndingContact(scenario, [crate, cone])).toBe('obstacle');
    expect(runEndingContact(scenario, [cone, wall])).toBe('wall');
  });

  it('ends no run of a scenario that does not say endOnContact', () => {
    expect(runEndingContact({}, [wall, cone])).toBeNull();
    expect(runEndingContact({ endOnContact: undefined }, [wall])).toBeNull();
  });

  it('matches the whole tag, not a part of it', () => {
    expect(runEndingContact(scenario, [{ otherId: 'x', tags: ['walls', 'obstacles', 'Wall'] }])).toBeNull();
  });
});

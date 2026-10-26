import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/all-goals.scenario.json';
import { ROBOT_CHECK_LIMITS } from './check-result';
import { loadScenario } from './scenario';
import { GOALS_MAX, SCENARIO_VERSION_MAX, ScenarioError } from './scenario-schema';

/** A fresh copy of the fixture, as plain JSON an edit may change. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authored = (): any => structuredClone(fixture);

/** The issues of a scenario that does not load, as `path: message` lines. */
function issuesOf(input: unknown): string[] {
  try {
    loadScenario(input);
  } catch (error) {
    if (error instanceof ScenarioError) {
      return error.issues.map((issue) => `${issue.path}: ${issue.message}`);
    }
    throw error;
  }
  throw new Error('the scenario loaded');
}

/** The scenario with `edit` applied to a fresh copy of the fixture. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const edited = (edit: (scenario: any) => void): unknown => {
  const scenario = authored();
  edit(scenario);
  return scenario;
};

describe('scenario shape', () => {
  it('refuses a value that is not an object, and unknown keys', () => {
    expect(issuesOf(null)).toEqual([': Invalid input: expected object, received null']);
    expect(issuesOf(edited((s) => (s.maxScore = 100)))).toEqual([': Unrecognized key: "maxScore"']);
  });

  it('refuses a key that is not one of the robot labs', () => {
    expect(issuesOf(edited((s) => (s.key = 'rb-nope')))).toEqual([
      'key: unknown scenario key "rb-nope"; the keys are rb-drive-to-zone, rb-square-route, rb-stop-at-wall, rb-line-follow, rb-servo-gate, rb-mini-mission, rb-sandbox',
    ]);
    expect(issuesOf(edited((s) => (s.key = 'ybc-blink')))).toHaveLength(1);
    expect(issuesOf(edited((s) => delete s.key))).toEqual(['key: Invalid input: expected string, received undefined']);
  });

  it.each([
    [0, 'version: must be a whole number from 1'],
    [1.5, 'version: must be a whole number from 1'],
    [-3, 'version: must be a whole number from 1'],
  ])('refuses version %s', (version, line) => {
    expect(issuesOf(edited((s) => (s.version = version)))).toEqual([line]);
  });

  it('checks profile and kit against the robot template table', () => {
    expect(issuesOf(edited((s) => (s.profile = 'uno-advanced')))).toEqual(['profile: rb-mini-mission needs the profile "uno-basic", not "uno-advanced"']);
    expect(issuesOf(edited((s) => (s.profile = 'ybc-basic')))).toEqual(['profile: Invalid option: expected one of "uno-basic"|"uno-advanced"']);
    expect(issuesOf(edited((s) => (s.kit = 'vendor-kit')))).toEqual(['kit: rb-mini-mission uses the kit "ref-uno-rover", not "vendor-kit"']);
  });

  it('needs a title in both languages, at most 120 characters', () => {
    expect(issuesOf(edited((s) => (s.title.vi = '   ')))).toEqual(['title.vi: must not be empty']);
    expect(issuesOf(edited((s) => delete s.title.en))).toEqual(['title.en: Invalid input: expected string, received undefined']);
    expect(issuesOf(edited((s) => (s.title.en = 'x'.repeat(121))))).toEqual(['title.en: at most 120 characters']);
  });

  it('puts the arena’s own path errors under `arena`', () => {
    expect(issuesOf(edited((s) => (s.arena.ground.sizeCm = [200, -1])))[0]).toMatch(/^arena\.ground\.sizeCm\[1\]: /);
    expect(issuesOf(edited((s) => (s.arena.paint.zones[1].polygonCm[0] = [999, 0])))).toEqual([
      'arena.paint.zones[1].polygonCm[0]: off the ground (x 0..200, y 0..160 cm)',
    ]);
  });
});

describe('start and time limit', () => {
  it('keeps the start on the ground, borders included', () => {
    expect(issuesOf(edited((s) => (s.start = { xCm: 201, yCm: 40, yawDeg: 0 })))).toEqual(['start: off the ground (x 0..200, y 0..160 cm)']);
    expect(issuesOf(edited((s) => (s.start = { xCm: 30, yCm: -0.5, yawDeg: 0 })))).toEqual(['start: off the ground (x 0..200, y 0..160 cm)']);
    expect(() => loadScenario(edited((s) => (s.start = { xCm: 0, yCm: 160, yawDeg: -270 })))).not.toThrow();
    expect(issuesOf(edited((s) => delete s.start.yawDeg))).toEqual(['start.yawDeg: Invalid input: expected number, received undefined']);
    expect(issuesOf(edited((s) => (s.start.zCm = 1)))).toEqual(['start: Unrecognized key: "zCm"']);
  });

  it('wants a time limit above 0 and at most 600 s', () => {
    expect(issuesOf(edited((s) => (s.timeLimitS = 0)))).toContain('timeLimitS: must be more than 0 s');
    expect(issuesOf(edited((s) => (s.timeLimitS = 601)))).toContain('timeLimitS: must be at most 600 s');
    expect(() => loadScenario(edited((s) => (s.timeLimitS = 600)))).not.toThrow();
  });
});

describe('variants', () => {
  it.each([
    ['count', 0, 'variants.count: must be a whole number from 1 to 10'],
    ['count', 11, 'variants.count: must be a whole number from 1 to 10'],
    ['count', 2.5, 'variants.count: must be a whole number from 1 to 10'],
    ['seed', -1, 'variants.seed: must be a whole number from 0 to 4294967295'],
    ['seed', 4294967296, 'variants.seed: must be a whole number from 0 to 4294967295'],
    ['seed', 1.5, 'variants.seed: must be a whole number from 0 to 4294967295'],
    ['startJitterCm', -1, 'variants.startJitterCm: must be 0 or more'],
    ['yawJitterDeg', -1, 'variants.yawJitterDeg: must be from 0 to 180'],
    ['yawJitterDeg', 181, 'variants.yawJitterDeg: must be from 0 to 180'],
    ['obstacleJitterCm', -0.1, 'variants.obstacleJitterCm: must be 0 or more'],
  ])('refuses %s = %s', (field, value, line) => {
    expect(issuesOf(edited((s) => (s.variants[field] = value)))).toEqual([line]);
  });

  it('allows ten variants, a seed of 0 and no obstacle jitter', () => {
    const scenario = loadScenario(
      edited((s) => {
        s.variants = { count: 10, seed: 0, startJitterCm: 0, yawJitterDeg: 0 };
      }),
    );
    expect(scenario.variants).toEqual({ count: 10, seed: 0, startJitterCm: 0, yawJitterDeg: 0 });
  });
});

describe('inputs', () => {
  const inputs = (list: object[]) => edited((s) => (s.inputs = list));

  it('refuses a role that is not a button of the kit vocabulary', () => {
    expect(issuesOf(inputs([{ atS: 1, role: 'servo1', action: 'press' }]))).toEqual(['inputs[0].role: "servo1" is not a button role (button1)']);
    expect(issuesOf(inputs([{ atS: 1, role: 'button9', action: 'press' }]))).toEqual(['inputs[0].role: "button9" is not a button role (button1)']);
  });

  it('keeps atS from 0 up to, not including, the time limit', () => {
    expect(issuesOf(inputs([{ atS: -0.1, role: 'button1', action: 'press' }]))).toEqual(['inputs[0].atS: must be at least 0 s and before the time limit (60 s)']);
    expect(issuesOf(inputs([{ atS: 60, role: 'button1', action: 'press' }]))).toEqual(['inputs[0].atS: must be at least 0 s and before the time limit (60 s)']);
    expect(() => loadScenario(inputs([{ atS: 0, role: 'button1', action: 'press' }, { atS: 59.999, role: 'button1', action: 'release' }]))).not.toThrow();
  });

  it('refuses an action other than press or release, and unknown keys', () => {
    expect(issuesOf(inputs([{ atS: 1, role: 'button1', action: 'tap' }]))).toEqual(['inputs[0].action: Invalid option: expected one of "press"|"release"']);
    expect(issuesOf(inputs([{ atS: 1, role: 'button1', action: 'press', durationS: 1 }]))).toEqual(['inputs[0]: Unrecognized key: "durationS"']);
  });

  it('wants a button to be pressed before it is released and released before it is pressed again', () => {
    expect(issuesOf(inputs([{ atS: 1, role: 'button1', action: 'release' }]))).toEqual(['inputs[0].action: button1 is not pressed, so it cannot be released']);
    expect(
      issuesOf(
        inputs([
          { atS: 1, role: 'button1', action: 'press' },
          { atS: 2, role: 'button1', action: 'press' },
        ]),
      ),
    ).toEqual(['inputs[1].action: button1 is already pressed']);
  });

  it('judges the order of time, not the order of writing', () => {
    // Written release first, but at 1 s the press has not come yet, so the press at 3 s is the one after it.
    expect(
      issuesOf(
        inputs([
          { atS: 3, role: 'button1', action: 'release' },
          { atS: 1, role: 'button1', action: 'press' },
          { atS: 2, role: 'button1', action: 'press' },
        ]),
      ),
    ).toEqual(['inputs[2].action: button1 is already pressed']);
  });

  it('refuses two inputs of one button at the same instant', () => {
    expect(
      issuesOf(
        inputs([
          { atS: 2, role: 'button1', action: 'press' },
          { atS: 2, role: 'button1', action: 'release' },
        ]),
      ),
    ).toEqual(['inputs[1].atS: button1 already has an input at 2 s']);
  });

  it('allows at most 100 inputs', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ atS: i * 0.5, role: 'button1', action: i % 2 === 0 ? 'press' : 'release' }));
    expect(issuesOf(inputs(many))).toEqual(['inputs: at most 100 inputs']);
  });
});

describe('goals', () => {
  const goal = (index: number) => (s: { goals: Record<string, unknown>[] }) => s.goals[index]!;
  const editGoal = (index: number, edit: (g: Record<string, unknown>) => void) => edited((s) => edit(goal(index)(s)));

  it('wants a unique id of lowercase letters, digits and "-", at most 50 characters', () => {
    expect(issuesOf(editGoal(0, (g) => (g.id = 'Reach_Dock')))).toEqual(['goals[0].id: a goal id is lowercase letters, digits and "-"']);
    expect(issuesOf(editGoal(0, (g) => (g.id = '')))).toContain('goals[0].id: a goal id is lowercase letters, digits and "-"');
    expect(issuesOf(editGoal(0, (g) => (g.id = 'a'.repeat(51))))).toEqual(['goals[0].id: a goal id is at most 50 characters']);
    expect(() => loadScenario(editGoal(0, (g) => (g.id = 'a'.repeat(50))))).not.toThrow();
    expect(issuesOf(editGoal(1, (g) => (g.id = 'reach-dock')))).toEqual(['goals[1].id: the id "reach-dock" is already used by goals[0]']);
  });

  it('wants a label in both languages, at most 200 characters', () => {
    expect(issuesOf(editGoal(2, (g) => (g.label = { vi: 'x' })))).toEqual(['goals[2].label.en: Invalid input: expected string, received undefined']);
    expect(issuesOf(editGoal(2, (g) => (g.label = { vi: '', en: 'x' })))).toEqual(['goals[2].label.vi: must not be empty']);
    expect(issuesOf(editGoal(2, (g) => (g.label = { vi: 'x', en: 'y'.repeat(201) })))).toEqual(['goals[2].label.en: at most 200 characters']);
    expect(() => loadScenario(editGoal(2, (g) => (g.label = { vi: 'x'.repeat(200), en: 'y'.repeat(200) })))).not.toThrow();
  });

  it('refuses a control or format character in a label or a title, as the LMS does, and trims as .NET trims (N18 final fix M5)', () => {
    const hidden = 'goals[2].label.vi: must not hold a control or format character (a line break, a tab, a zero-width or bidi mark)';
    for (const label of ['Xe dừng\nhẳn', 'Xe\tdừng', 'Xe\u{200B}dừng', 'Xe dừng \u{202E}nẳh', '\u{FEFF}Xe dừng', 'Xe dừng\u{FEFF}', 'Xe\u{85}dừng', 'Xe dừng\u{AD}hẳn']) {
      expect(issuesOf(editGoal(2, (g) => (g.label = { vi: label, en: 'x' }))), JSON.stringify(label)).toEqual([hidden]);
    }
    expect(issuesOf(edited((s) => (s.title.en = 'Park\u{2066}ing')))).toEqual(['title.en: must not hold a control or format character (a line break, a tab, a zero-width or bidi mark)']);
    // Trimmed, as LabAttemptRules trims: a U+0085 or a line break at an edge goes, and the label the check sends is the trimmed one.
    const trimmed = loadScenario(editGoal(2, (g) => (g.label = { vi: '\u{85} Xe dừng hẳn\n', en: ' Stop\u{A0}' })));
    expect(trimmed.goals[2]!.label).toEqual({ vi: 'Xe dừng hẳn', en: 'Stop' });
    // A lone surrogate is no Cc or Cf code point: taken, as .NET takes it.
    expect(() => loadScenario(editGoal(2, (g) => (g.label = { vi: 'Xe \u{D800}', en: 'x' })))).not.toThrow();
  });

  it('wants points that are whole numbers, 0 or more', () => {
    // Moving 10 points from goal 0 to the time bonus keeps the total at 100, so only the field is at fault.
    expect(issuesOf(editGoal(0, (g) => (g.points = -1)))).toContain('goals[0].points: must be a whole number, 0 or more');
    expect(issuesOf(editGoal(0, (g) => (g.points = 2.5)))).toContain('goals[0].points: must be a whole number, 0 or more');
    expect(
      () =>
        loadScenario(
          edited((s) => {
            s.goals[0].points = 0;
            s.scoring.timeBonusMax = 20;
          }),
        ),
    ).not.toThrow();
  });

  it('refuses an unknown kind, a missing field of its kind and a field of another kind', () => {
    expect(issuesOf(editGoal(0, (g) => (g.kind = 'win')))).toEqual([
      'goals[0].kind: unknown goal kind "win"; the kinds are reach-zone, checkpoints-in-order, stay-on-line, avoid-contact, object-in-zone, stop-in-zone, servo-angle, finish-within, uses-block, object-held, object-placed, object-on-object, object-unmoved',
    ]);
    expect(issuesOf(editGoal(0, (g) => delete g.zone))).toEqual(['goals[0].zone: Invalid input: expected string, received undefined']);
    expect(issuesOf(editGoal(0, (g) => (g.minRatio = 0.5)))).toEqual(['goals[0]: Unrecognized key: "minRatio"']);
  });

  it('wants zones to be zones of the arena', () => {
    expect(issuesOf(editGoal(0, (g) => (g.zone = 'nowhere')))).toEqual(['goals[0].zone: no zone "nowhere" in the arena (zones: start, cp-a, cp-b, dock, gate)']);
    expect(issuesOf(editGoal(1, (g) => (g.zones = ['cp-a', 'cp-x', 'dock'])))).toEqual(['goals[1].zones[1]: no zone "cp-x" in the arena (zones: start, cp-a, cp-b, dock, gate)']);
    expect(issuesOf(editGoal(1, (g) => (g.zones = [])))).toEqual(['goals[1].zones: needs at least one zone']);
    expect(() => loadScenario(editGoal(1, (g) => (g.zones = ['cp-a', 'cp-b', 'cp-a'])))).not.toThrow();
    expect(issuesOf(editGoal(5, (g) => (g.zone = 'crate')))).toEqual(['goals[5].zone: no zone "crate" in the arena (zones: start, cp-a, cp-b, dock, gate)']);
    expect(issuesOf(editGoal(6, (g) => (g.whenInZone = 'nowhere')))).toEqual(['goals[6].whenInZone: no zone "nowhere" in the arena (zones: start, cp-a, cp-b, dock, gate)']);
  });

  it('wants stay-on-line to have a line to stay on, and a ratio above 0 up to 1', () => {
    expect(issuesOf(editGoal(2, (g) => (g.minRatio = 0)))).toEqual(['goals[2].minRatio: must be more than 0 and at most 1']);
    expect(issuesOf(editGoal(2, (g) => (g.minRatio = 1.01)))).toEqual(['goals[2].minRatio: must be more than 0 and at most 1']);
    expect(() => loadScenario(editGoal(2, (g) => (g.minRatio = 1)))).not.toThrow();
    expect(
      issuesOf(
        edited((s) => {
          s.arena.paint.lines = [];
        }),
      ),
    ).toEqual(['goals[2].kind: stay-on-line needs a line painted in the arena']);
  });

  it('wants avoid-contact to name a kind or a tag that something in the arena has', () => {
    expect(issuesOf(editGoal(3, (g) => (g.tag = 'lava')))).toEqual(['goals[3].tag: nothing in the arena has the tag "lava" (tags: wall, box, cylinder, object, obstacle, jitter, pushable)']);
    expect(() => loadScenario(editGoal(3, (g) => (g.tag = 'wall')))).not.toThrow();
    expect(() => loadScenario(editGoal(3, (g) => (g.tag = 'pushable')))).not.toThrow();
    // The ground is always touched, so it is no tag to avoid; and a kind the arena has none of is no tag either.
    expect(issuesOf(editGoal(3, (g) => (g.tag = 'ground')))[0]).toMatch(/^goals\[3\]\.tag: nothing in the arena has the tag "ground"/);
    expect(
      issuesOf(
        edited((s) => {
          s.arena.walls = [];
          s.goals[3].tag = 'wall';
        }),
      ),
    ).toEqual(['goals[3].tag: nothing in the arena has the tag "wall" (tags: box, cylinder, object, obstacle, jitter, pushable)']);
  });

  it('wants object-in-zone to name an object of the arena', () => {
    expect(issuesOf(editGoal(4, (g) => (g.object = 'bench')))).toEqual(['goals[4].object: no object "bench" in the arena (objects: crate)']);
    expect(issuesOf(editGoal(4, (g) => (g.zone = 'crate')))).toEqual(['goals[4].zone: no zone "crate" in the arena (zones: start, cp-a, cp-b, dock, gate)']);
    expect(
      issuesOf(
        edited((s) => {
          s.arena.objects = [];
        }),
      ),
    ).toEqual(['goals[4].object: no object "crate" in the arena (the arena has no objects)']);
  });

  it('wants stop-in-zone to have a speed and a hold above 0 that fit the time limit', () => {
    expect(issuesOf(editGoal(5, (g) => (g.maxSpeedCmS = 0)))).toEqual(['goals[5].maxSpeedCmS: must be more than 0']);
    expect(issuesOf(editGoal(5, (g) => (g.holdS = 0)))).toEqual(['goals[5].holdS: must be more than 0']);
    expect(issuesOf(editGoal(5, (g) => (g.holdS = 61)))).toEqual(['goals[5].holdS: must not be more than the time limit (60 s)']);
  });

  it('wants servo-angle to name a servo role and an angle range of the servo (0..180°)', () => {
    expect(issuesOf(editGoal(6, (g) => (g.role = 'motorLeft')))).toEqual(['goals[6].role: "motorLeft" is not a servo role (servo1)']);
    expect(issuesOf(editGoal(6, (g) => (g.minDeg = -1)))).toEqual(['goals[6].minDeg: must be from 0 to 180']);
    expect(issuesOf(editGoal(6, (g) => (g.maxDeg = 181)))).toEqual(['goals[6].maxDeg: must be from 0 to 180']);
    expect(issuesOf(editGoal(6, (g) => ((g.minDeg = 100), (g.maxDeg = 80))))).toEqual(['goals[6].maxDeg: must be at least minDeg (100)']);
    expect(() => loadScenario(editGoal(6, (g) => ((g.minDeg = 90), (g.maxDeg = 90), delete g.whenInZone)))).not.toThrow();
  });

  it('wants finish-within to be above 0 and within the time limit', () => {
    expect(issuesOf(editGoal(7, (g) => (g.seconds = 0)))).toEqual(['goals[7].seconds: must be more than 0']);
    expect(issuesOf(editGoal(7, (g) => (g.seconds = 61)))).toEqual(['goals[7].seconds: must not be more than the time limit (60 s)']);
    expect(() => loadScenario(editGoal(7, (g) => (g.seconds = 60)))).not.toThrow();
  });

  it('wants uses-block to name a block type, one that the toolbox lists when there is a toolbox', () => {
    expect(issuesOf(editGoal(8, (g) => (g.blockType = 'repeat block')))).toEqual(['goals[8].blockType: a block type is letters, digits and "_"']);
    expect(issuesOf(editGoal(8, (g) => (g.blockType = 'controls_whileUntil')))).toEqual(['goals[8].blockType: the toolbox does not list "controls_whileUntil"']);
    expect(
      () =>
        loadScenario(
          edited((s) => {
            delete s.toolbox;
            s.goals[8].blockType = 'controls_whileUntil';
          }),
        ),
    ).not.toThrow();
  });
});

describe('score', () => {
  it('adds up to exactly 100: goal points plus the time bonus', () => {
    expect(issuesOf(edited((s) => (s.scoring.timeBonusMax = 5)))).toEqual(['goals: the points add up to 95 (goals 90 + time bonus 5), not 100']);
    expect(issuesOf(edited((s) => delete s.scoring.timeBonusMax))).toEqual(['goals: the points add up to 90 (goals 90 + time bonus 0), not 100']);
    expect(issuesOf(edited((s) => (s.goals[0].points = 20)))).toEqual(['goals: the points add up to 110 (goals 100 + time bonus 10), not 100']);
    expect(() =>
      loadScenario(
        edited((s) => {
          s.scoring = {};
          s.goals[0].points = 20;
        }),
      ),
    ).not.toThrow();
  });

  it('wants a time bonus that is a whole number, 0 or more', () => {
    expect(issuesOf(edited((s) => (s.scoring.timeBonusMax = -10)))).toContain('scoring.timeBonusMax: must be a whole number, 0 or more');
    expect(issuesOf(edited((s) => (s.scoring.timeBonusMax = 2.5)))).toContain('scoring.timeBonusMax: must be a whole number, 0 or more');
  });

  it('wants at least one goal, except for the sandbox', () => {
    expect(
      issuesOf(
        edited((s) => {
          s.goals = [];
          s.scoring = {};
        }),
      ),
    ).toEqual(['goals: a scored scenario needs at least one goal (only rb-sandbox has none)']);
  });

  it('keeps penalties out until R6.2 defines them', () => {
    expect(issuesOf(edited((s) => (s.scoring.penalties = [{ kind: 'contact' }])))).toEqual(['scoring.penalties: no penalty kind exists yet']);
    expect(() => loadScenario(edited((s) => (s.scoring.penalties = [])))).not.toThrow();
  });

  it('lets rb-sandbox have no goal and no score, and refuses it any', () => {
    const sandbox = () =>
      edited((s) => {
        s.key = 'rb-sandbox';
        s.goals = [];
        s.scoring = {};
        s.inputs = [];
        s.toolbox = undefined;
      });
    expect(() => loadScenario(sandbox())).not.toThrow();
    expect(issuesOf(edited((s) => ((s.key = 'rb-sandbox'), (s.toolbox = undefined))))).toEqual([
      'goals: rb-sandbox has no goals',
      'scoring.timeBonusMax: rb-sandbox has no score',
    ]);
    const withBonus = sandbox() as { scoring: object };
    withBonus.scoring = { timeBonusMax: 1 };
    expect(issuesOf(withBonus)).toEqual(['scoring.timeBonusMax: rb-sandbox has no score']);
  });
});

describe('starter and toolbox', () => {
  it('takes any object as the starter program, and an empty one', () => {
    expect(loadScenario(edited((s) => (s.starter = {}))).starter).toEqual({});
    expect(issuesOf(edited((s) => (s.starter = [])))).toEqual(['starter: Invalid input: expected record, received array']);
    expect(issuesOf(edited((s) => (s.starter = null)))).toEqual(['starter: Invalid input: expected record, received null']);
    expect(issuesOf(edited((s) => delete s.starter))).toEqual(['starter: Invalid input: expected record, received undefined']);
  });

  it('wants a toolbox to be a list of block types, each once', () => {
    expect(issuesOf(edited((s) => (s.toolbox = [])))[0]).toBe('toolbox: needs at least one block type');
    expect(issuesOf(edited((s) => (s.toolbox = ['controls_repeat_ext', 'controls_if', 'controls_if'])))).toEqual([
      'toolbox[2]: "controls_if" is already listed at toolbox[1]',
    ]);
    expect(issuesOf(edited((s) => (s.toolbox = ['controls_if', 'not a type', 'controls_repeat_ext'])))).toEqual(['toolbox[1]: a block type is letters, digits and "_"']);
    expect(loadScenario(edited((s) => delete s.toolbox)).toolbox).toBeUndefined();
  });
});

describe('ScenarioError', () => {
  it('names the scenario and every path at fault in its message', () => {
    try {
      loadScenario(
        edited((s) => {
          s.goals[0].zone = 'nowhere';
          s.start.xCm = 500;
        }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ScenarioError);
      expect((error as Error).message).toBe(
        'Invalid scenario "rb-mini-mission": start: off the ground (x 0..200, y 0..160 cm); goals[0].zone: no zone "nowhere" in the arena (zones: start, cp-a, cp-b, dock, gate)',
      );
    }
  });
});

// N18 R5.2a fix round 2 (controller ruling): the tags whose first contact ends the run, as a crash does in a robot competition.
describe('endOnContact', () => {
  it('is optional, and left out when the scenario does not say it', () => {
    expect(loadScenario(authored()).endOnContact).toBeUndefined();
  });

  it('takes tags and kinds that something in the arena has, each once', () => {
    const scenario = loadScenario(edited((s) => (s.endOnContact = ['obstacle', 'wall'])));
    expect(scenario.endOnContact).toEqual(['obstacle', 'wall']);
  });

  it('refuses a tag nothing in the arena has, an empty tag, a tag twice, and an empty list', () => {
    expect(issuesOf(edited((s) => (s.endOnContact = ['lava'])))).toEqual([
      'endOnContact[0]: nothing in the arena has the tag "lava" (tags: wall, box, cylinder, object, obstacle, jitter, pushable)',
    ]);
    expect(issuesOf(edited((s) => (s.endOnContact = ['ground'])))[0]).toMatch(/^endOnContact\[0\]: nothing in the arena has the tag "ground"/);
    expect(issuesOf(edited((s) => (s.endOnContact = ['wall', 'wall'])))).toEqual(['endOnContact[1]: "wall" is already listed at endOnContact[0]']);
    expect(issuesOf(edited((s) => (s.endOnContact = [''])))).toEqual(['endOnContact[0]: must not be empty']);
    expect(issuesOf(edited((s) => (s.endOnContact = [])))).toEqual(['endOnContact: needs at least one tag']);
  });
});

// N18 R5.2a fix round 2: a start can move farther along its heading than across it (a line follower's start straight).
describe('startJitterAlongCm', () => {
  it('is optional and 0 or more', () => {
    expect(loadScenario(authored()).variants.startJitterAlongCm).toBeUndefined();
    expect(loadScenario(edited((s) => (s.variants.startJitterAlongCm = 15))).variants.startJitterAlongCm).toBe(15);
    expect(issuesOf(edited((s) => (s.variants.startJitterAlongCm = -1)))).toEqual(['variants.startJitterAlongCm: must be 0 or more']);
  });
});

// N18 R6.2 fix round 1 (controller ruling): what the LMS stores bounds a scenario. LearningService keeps at most 20 goals of a lab attempt
// (LabAttemptRules.MaxGoals), and a check result's scenarioVersion is a 32-bit int (ROBOT_CHECK_LIMITS, the host's ROBOT_LIMITS).
describe('the bounds the LMS stores', () => {
  const reach = (i: number, points: number) => ({ id: `g${i}`, kind: 'reach-zone', label: { vi: `Mục tiêu ${i}`, en: `Goal ${i}` }, points, zone: 'dock' });
  const withGoals = (goals: unknown[]) => edited((s) => {
    s.goals = goals;
    s.scoring = {};
  });

  it('are the host’s: 20 goals at most, within its 50, and the version of a 32-bit int', () => {
    expect(GOALS_MAX).toBe(20);
    expect(GOALS_MAX).toBeLessThanOrEqual(ROBOT_CHECK_LIMITS.maxGoals);
    expect(SCENARIO_VERSION_MAX).toBe(ROBOT_CHECK_LIMITS.scenarioVersionMax);
  });

  it('takes 20 goals and refuses 21', () => {
    expect(loadScenario(withGoals(Array.from({ length: 20 }, (_, i) => reach(i, 5)))).goals).toHaveLength(20);
    expect(issuesOf(withGoals(Array.from({ length: 21 }, (_, i) => reach(i, i < 20 ? 5 : 0))))).toEqual(['goals: at most 20 goals (the LMS stores 20 a lab)']);
  });

  it('takes a version up to 2147483647 and refuses one more', () => {
    expect(loadScenario(edited((s) => (s.version = 2_147_483_647))).version).toBe(2_147_483_647);
    expect(issuesOf(edited((s) => (s.version = 2_147_483_648)))).toEqual(['version: must be a whole number from 1 to 2147483647']);
  });
});

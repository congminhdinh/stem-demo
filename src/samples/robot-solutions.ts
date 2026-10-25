import type { robotSandboxKey, RobotTemplateKey } from './robot-keys';

// The finished programs of the robot scenarios (N18 R5.2, robot plan §4.6; tests and the scenario authors only, the app never imports
// this file). For each scored scenario of `src/samples/robot-scenarios/`:
//
//   reference  the program the lesson asks for, written as a learner would with the scenario's toolbox. It must pass every goal in every
//              variant, with a margin (R5.2b runs it through the check; R5.2a compiles it and turns its sketch into a golden of C1).
//   blind      (lessons 3-6) a "blind" program: motors and waits only, no sensor, timed so that it solves variant 0. It must fail at least
//              one variant, which is the proof that the variants of the scenario mean something.
//   exploits   programs that try to score without doing the lesson (from the R5.2a reviews), each with the most the check may give it:
//              regression cases for R5.2b's check, which must fail every one of them and give it at most that score.
//   notes      what the timings rest on.
//
// Every program is a Blockly workspace as `Blockly.serialization.workspaces.save` writes it (tests/robot-scenarios.test.ts loads it into
// real Blockly and saves it again). The numbers a learner types are shadow blocks, as the toolbox gives them.
//
// PLACEHOLDER KIT. Every time and distance below is for `ref-uno-rover@0`, whose mechanics are placeholders (src/core/hardware/kits/README.md):
// free speed 0.48 m/s at 100 %, about 0.13 m/s at 50 %, no motion below a duty of about 80 (31 %); a spin turn at 50 % turns about 108°/s.
// When the vendor's measurements replace them (plan VG) the open-loop timings (lessons 1-2 and every blind program) must be measured again,
// the arena zones checked against them, and the scenarios' `version` raised. The sensor programs (lessons 3-6) depend on the kit only through
// the speed (stopping distance, the time a curve takes) and the sensor positions.

type Json = Record<string, unknown>;

/** A Blockly workspace in JSON, as Blockly saves it. */
export type BlocklyJson = Json;

/**
 * A program that tries to score without doing what the lesson asks (an open-loop program, or one that skips the lesson's sensor), which the
 * check must not pass (rule 10 of docs/robot-scenario-authoring.md), and the most the check may give it.
 */
export type RobotExploit = {
  /** A name for the test that runs it, `[a-z0-9-]`. */
  readonly name: string;
  /** What it does, and why it must not score more. */
  readonly description: string;
  readonly program: BlocklyJson;
  /**
   * The most the check may give it, time bonus included: its score, the lowest of its variants' (R6.2's rule), as the spike measured it.
   * At most 60 (rule 10).
   */
  readonly maxScore: number;
};

export type RobotSolution = {
  readonly reference: BlocklyJson;
  /** Lessons 3-6: motors and waits only, timed for variant 0. */
  readonly blind?: BlocklyJson;
  readonly exploits?: readonly RobotExploit[];
  readonly notes: string;
};

// --- Blockly JSON of the robot's blocks -------------------------------------------------------------------------------------------------

/** Statements linked by `next`, as Blockly saves a stack. */
export function chain(statements: readonly Json[]): Json | undefined {
  const [first, ...rest] = statements;
  if (!first) {
    return undefined;
  }
  const next = chain(rest);
  return next ? { ...first, next: { block: next } } : first;
}

const statements = (body: readonly Json[]): { block: Json } | undefined => {
  const first = chain(body);
  return first ? { block: first } : undefined;
};

/** A number typed into a block. */
export const numberBlock = (id: string, value: number): Json => ({ type: 'math_number', id, fields: { NUM: value } });
/** A number in a socket the toolbox fills with a shadow (a drive's speed, a wait's ms): the learner types over it. */
const shadowNumber = (id: string, value: number) => ({ shadow: numberBlock(id, value) });

export type DriveDirection = 'forward' | 'backward' | 'spinLeft' | 'spinRight';
export type LineRole = 'lineLeft' | 'lineCenter' | 'lineRight';

/** "robot go <direction> speed <speed> %" (U-21). */
export const drive = (id: string, direction: DriveDirection, speed: number): Json => ({
  type: 'uno_drive_move',
  id,
  fields: { DIRECTION: direction },
  inputs: { SPEED: shadowNumber(`${id}-speed`, speed) },
});
/** "stop the robot" (U-22). */
export const stop = (id: string): Json => ({ type: 'uno_drive_stop', id });
/** "wait <ms> ms" (U-18). */
export const wait = (id: string, ms: number): Json => ({ type: 'ybc_wait_ms', id, inputs: { MS: shadowNumber(`${id}-ms`, ms) } });
/** "servo 1 angle <angle> °" (U-23). */
export const servo = (id: string, angle: number): Json => ({
  type: 'uno_servo_set',
  id,
  fields: { ROLE: 'servo1' },
  inputs: { ANGLE: shadowNumber(`${id}-angle`, angle) },
});
/** "ultrasonic distance (cm)" (U-27). */
export const ultrasonic = (id: string): Json => ({ type: 'uno_ultrasonic_cm', id });
/** "line sensor <role> sees the dark line" (U-28). */
export const lineDark = (id: string, role: LineRole): Json => ({ type: 'uno_line_dark', id, fields: { ROLE: role } });
/** "<a> <op> <b>" (U-09). */
export const compare = (id: string, op: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE', a: Json, b: Json): Json => ({
  type: 'logic_compare',
  id,
  fields: { OP: op },
  inputs: { A: { block: a }, B: { block: b } },
});
/** "ultrasonic distance (cm) < <cm>". */
export const closerThan = (id: string, cm: number): Json => compare(id, 'LT', ultrasonic(`${id}-distance`), numberBlock(`${id}-cm`, cm));

/** "repeat <times> times" (U-12). */
export function repeat(id: string, times: number, body: readonly Json[]): Json {
  const DO = statements(body);
  return { type: 'controls_repeat_ext', id, inputs: { TIMES: shadowNumber(`${id}-times`, times), ...(DO ? { DO } : {}) } };
}

/** if / else if … / else (U-11), as Blockly saves it: `branches` are [condition, statements]. */
export function ifBlock(id: string, branches: readonly (readonly [Json, readonly Json[]])[], otherwise?: readonly Json[]): Json {
  const extraState = {
    ...(branches.length > 1 ? { elseIfCount: branches.length - 1 } : {}),
    ...(otherwise ? { hasElse: true } : {}),
  };
  const inputs: Json = {};
  branches.forEach(([condition, body], index) => {
    inputs[`IF${index}`] = { block: condition };
    const DO = statements(body);
    if (DO) {
      inputs[`DO${index}`] = DO;
    }
  });
  const ELSE = otherwise ? statements(otherwise) : undefined;
  if (ELSE) {
    inputs.ELSE = ELSE;
  }
  return { type: 'controls_if', id, ...(Object.keys(extraState).length > 0 ? { extraState } : {}), inputs };
}

export type HatType = 'stem_on_start' | 'stem_forever';

/** A hat at (x, y) with its statements. */
export function hat(type: HatType, body: readonly Json[], at: { x: number; y: number } = { x: 40, y: 40 }): Json {
  const DO = statements(body);
  return { type, id: type === 'stem_on_start' ? 'on-start' : 'forever', x: at.x, y: at.y, ...(DO ? { inputs: { DO } } : {}) };
}

/** A block lying loose in the workspace, which Blockly disables until it is attached (a starter's prepared block). */
export const loose = (block: Json, at: { x: number; y: number }): Json => ({ ...block, x: at.x, y: at.y, disabledReasons: ['ORPHANED_BLOCK'] });

/** A workspace of these top blocks. */
export const workspace = (...top: readonly Json[]): BlocklyJson => ({ blocks: { languageVersion: 0, blocks: [...top] } });

// --- The programs -----------------------------------------------------------------------------------------------------------------------

/** The cruising speed of every solution, %: well above the placeholder kit's dead band (31 %), the toolbox's default. */
export const CRUISE = 50;

/** The three-sensor line follower of lessons 4 and 6: forward on the line, spin towards it when only a side sensor sees it. */
export const followLine = (prefix: string): readonly (readonly [Json, readonly Json[]])[] => [
  [lineDark(`${prefix}-center`, 'lineCenter'), [drive(`${prefix}-forward`, 'forward', CRUISE)]],
  [lineDark(`${prefix}-left`, 'lineLeft'), [drive(`${prefix}-spin-left`, 'spinLeft', CRUISE)]],
  [lineDark(`${prefix}-right`, 'lineRight'), [drive(`${prefix}-spin-right`, 'spinRight', CRUISE)]],
];

/** Drive forward for `ms`, spin left for `turnMs`, as one leg of an open-loop route. */
const leg = (id: string, ms: number, turnMs?: number): Json[] => [
  drive(`${id}-forward`, 'forward', CRUISE),
  wait(`${id}-wait`, ms),
  ...(turnMs === undefined ? [] : [drive(`${id}-turn`, 'spinLeft', CRUISE), wait(`${id}-turn-wait`, turnMs)]),
];

/** The scenarios that have goals, and so a solution: every key but the sandbox. */
export type RobotScoredKey = Exclude<RobotTemplateKey, typeof robotSandboxKey>;

// The numbers in the notes were measured with spikes/r52-scenario-sim (a stand-in for R3.6 and R6.2: the compiled program on the virtual UNO,
// R3.5's createScenarioWorld and goal frame, R6.1's goals; see its results/ and the R5.2a report), not computed: R5.2b checks them again
// through the real run session and check.
export const robotSolutions: Readonly<Record<RobotScoredKey, RobotSolution>> = {
  'rb-drive-to-zone': {
    reference: workspace(hat('stem_on_start', [drive('go', 'forward', CRUISE), wait('drive-time', 5000), stop('stop')])),
    notes:
      'Open loop. 50 % for 5000 ms drives 66.9 cm (13.4 cm/s once moving): the middle of the robot stops at x = 91.8 cm, inside the target zone ' +
      '(x 76..106), and holds still from 5.0 s (stop-in-zone passes at 6.0 s). The zone allows about ±1.1 s at this speed. Placeholder kit: the ' +
      'wait is (zone centre − start) / the speed at 50 %; with the vendor kit, measure that speed and set the wait again, the zone stays.',
  },
  'rb-square-route': {
    reference: workspace(
      hat('stem_on_start', [repeat('square', 4, [drive('side', 'forward', CRUISE), wait('side-time', 4500), drive('turn', 'spinLeft', CRUISE), wait('turn-time', 830)]), stop('stop')]),
    ),
    notes:
      'Open loop. A side is 50 % for 4500 ms (60 cm), a corner a spin left at 50 % for 830 ms (90.4°, from a forward run); the square closes 2.4 cm ' +
      'from the start, 1.7° off. Each checkpoint is crossed 13..15 cm inside its 30 cm width. Placeholder kit: the turn time depends on the spin rate ' +
      '(about 108°/s at 50 %) and is the number the vendor kit changes most; a 4.5° error per corner (5 %) moves the crossings at most 5 cm across ' +
      'the path, still inside.',
  },
  'rb-stop-at-wall': {
    reference: workspace(hat('stem_forever', [ifBlock('if-near', [[closerThan('near', 15), [stop('stop')]]], [drive('go', 'forward', CRUISE)])])),
    blind: workspace(hat('stem_on_start', [drive('go', 'forward', CRUISE), wait('drive-time', 6800), stop('stop')])),
    notes:
      'Reference: stop once the echo reads under 15 cm, the threshold the lesson\'s theory gives. The middle stops at x = 135.8..135.9 ' +
      'in all three variants (the front 14.7 cm from the wall; zone x 126..146), whatever the start, since coasting from 13.4 cm/s ' +
      'takes under 1 cm. The kit enters through that stopping distance and the sensor 7.5 cm ahead of the middle. Measured: a threshold ' +
      'of 10 cm stops at x 140.9 and one of 20 cm at 130.8, both in the zone; 25 cm stops at 125.9, short of it. A touch of a wall ends ' +
      'the run (endOnContact), as a crash does in a competition, so driving into the wall and backing off parks nowhere (exploit ' +
      'below). Blind: 50 % for 6800 ms (91.1 cm) stops at x = 136.1 from the authored start. The seed (3004) moves variant 1 17.6 cm ' +
      'further on, where the blind program hits the wall at 6.6 s and the run ends, and variant 2 17.5 cm back, where it stops 7.4 cm ' +
      'short of the zone.',
    exploits: [
      {
        name: 'crash-and-back-off',
        description:
          'Forward until it runs into the wall, back for 1.1 s, stop: the wall is the same in every variant, so backing off a fixed time ' +
          'parks in the zone wherever it started. The run ends at the crash (endOnContact), so it parks nowhere.',
        program: workspace(hat('stem_on_start', [drive('go', 'forward', CRUISE), wait('drive-time', 10000), drive('back', 'backward', CRUISE), wait('back-time', 1100), stop('stop')])),
        maxScore: 0,
      },
    ],
  },
  'rb-line-follow': {
    reference: workspace(hat('stem_forever', [ifBlock('if-line', followLine('line'), [stop('lost')])])),
    blind: workspace(
      hat('stem_on_start', [...leg('leg-1', 5150, 415), ...leg('leg-2', 2050, 415), ...leg('leg-3', 2850, 415), ...leg('leg-4', 1950, 415), ...leg('leg-5', 7300), stop('stop')]),
    ),
    notes:
      'Reference: the centre-sensor follower: forward while the centre sensor sees the line, spin towards it (50 %) while only a side ' +
      'sensor does, stop when none does, which is where the tape ends, in the garage. The share on the tape is 0.999 of the distance in ' +
      'all three variants; the robot enters the garage at 19.5..19.7 s and stops at x 17.7, 8 cm before its back wall. The same ' +
      'follower at 40 % enters at 40.9..41.2 s and at 35 % (just over the dead band) at 93.1..93.7 s, hence the time limit of 120 s. ' +
      'Lesson 4 must teach this follower: one on the two side sensors only (forward while neither sees the line) stalls at the first ' +
      '45° corner (x 113.5 in every variant) with the placeholder kit\'s sensors 1.5 cm apart. The kit enters through the sensor bar ' +
      '(three sensors 1.5 cm apart, 7 cm ahead of the middle): a start whose bar lies within 2.75 cm of the line finds it, which the ' +
      'jitter (1.5 cm, 5°) keeps. Blind: five legs at 50 % (5150, 2050, 2850, 1950, 7300 ms) with spins of 415 ms, found by a grid ' +
      'search on variant 0: share 0.965, in the garage at 19.1 s. The seed (485) turns variants 1 and 2 by −4.9° and +4.9°: share 0.576 ' +
      'and 0.481, so the line goal fails; it still gets into the garage (60), since turning the start moves the garage end of the route ' +
      'along the corridor more than across it, so the check gives it 60 and does not pass it; so does a three-leg route that keeps away ' +
      'from the tape (exploit below). The garage stops a dash: its mouth faces the way the tape comes in, so any straight line from the ' +
      'start into it crosses its south wall.',
    exploits: [
      {
        name: 'crawl-and-dash',
        description:
          'Forward at 33 % (just over the dead band) for 12 s on the tape, a spin left of 830 ms, forward at 100 % for 1.8 s, stop. A crawl ' +
          'on the tape bought a share counted by ticks; counted by distance it buys nothing, and the dash across the arena cannot get into ' +
          'the garage, whose mouth faces the way the tape comes in.',
        program: workspace(
          hat('stem_on_start', [drive('crawl', 'forward', 33), wait('crawl-time', 12000), drive('turn', 'spinLeft', CRUISE), wait('turn-time', 830), drive('dash', 'forward', 100), wait('dash-time', 1800), stop('stop')]),
        ),
        maxScore: 0,
      },
      {
        name: 'short-drive',
        description: 'Forward at 50 % for 1.8 s, then stop: 24 cm along the first straight, on the tape. It meets the guard goal and nothing else.',
        program: workspace(hat('stem_on_start', [drive('go', 'forward', CRUISE), wait('drive-time', 1800), stop('stop')])),
        maxScore: 40,
      },
      {
        name: 'three-leg-route',
        description:
          'East 6750 ms, a spin left of 820 ms, north 5900 ms, a spin left of 820 ms, west 8600 ms, at 50 %: three legs across the arena ' +
          'into the garage, timed on variant 0, away from the tape at the corners. It gets the garage and not the line.',
        program: workspace(hat('stem_on_start', [...leg('east', 6750, 820), ...leg('north', 5900, 820), ...leg('west', 8600), stop('stop')])),
        maxScore: 60,
      },
    ],
  },
  'rb-servo-gate': {
    reference: workspace(
      hat('stem_forever', [ifBlock('if-near', [[closerThan('near', 15), [stop('stop'), servo('flag-up', 160)]]], [drive('go', 'forward', CRUISE)])]),
    ),
    blind: workspace(hat('stem_on_start', [drive('go', 'forward', CRUISE), wait('drive-time', 5800), stop('stop'), servo('flag-up', 160)])),
    notes:
      'Reference: lesson 3 against the gate, and the flag to 160° once stopped. The middle stops at x = 117.8..117.9 in all three ' +
      'variants (zone x 108..128) and the flag holds in range from 5.2..7.7 s. The servo starts at 90° (the Servo library writes 90 ' +
      'when attached), outside the goal range 150..180°, so only a program that turns it passes. flag-at-gate (whenInZone) does not ask ' +
      'the robot to stop: a robot that crosses the zone with the flag up meets it, which is why stop-at-gate (40) and no-crash (20) ' +
      'carry the rest, and a touch of the gate ends the run (endOnContact), so backing off it parks nowhere (exploits below). Blind: 50 ' +
      '% for 5800 ms stops at x = 117.6 from the authored start. The seed (1409, jitter 18 cm) moves variant 1 16.9 cm further on, ' +
      'where the body runs into the gate at 5.65 s and the run ends, and variant 2 17.3 cm back, where it stops 7.8 cm short.',
    exploits: [
      {
        name: 'flag-and-crash',
        description:
          'The flag up, then forward with no stop: the flag is up while the robot crosses the zone, which servo-angle (whenInZone) takes ' +
          'without a stop, then the robot runs into the gate. It gets the flag and nothing else.',
        program: workspace(hat('stem_on_start', [servo('flag-up', 160), drive('go', 'forward', CRUISE)])),
        maxScore: 40,
      },
      {
        name: 'flag-crash-and-back-off',
        description:
          'The flag up, forward into the gate, back for 1.1 s, stop: the gate is the same in every variant, so backing off a fixed time ' +
          'parks in the zone. The run ends at the crash (endOnContact), so it keeps only the flag it showed crossing the zone.',
        program: workspace(
          hat('stem_on_start', [servo('flag-up', 160), drive('go', 'forward', CRUISE), wait('drive-time', 9000), drive('back', 'backward', CRUISE), wait('back-time', 1100), stop('stop')]),
        ),
        maxScore: 40,
      },
    ],
  },
  'rb-mini-mission': {
    reference: workspace(hat('stem_forever', [ifBlock('if-mission', [[closerThan('near', 15), [stop('stop')]], ...followLine('line')])])),
    blind: workspace(hat('stem_on_start', [...leg('leg-1', 5200, 415), ...leg('leg-2', 3150, 415), ...leg('leg-3', 4200), stop('stop')])),
    notes:
      'Reference: the follower of lesson 4 under the stop of lesson 3. Share on the tape 1.000 in all three variants; it parks at x ' +
      '141.2, y 115.8..115.9 by 13.3..15.4 s (finish-within 30 s, so the time bonus has room) and passes the cones at 2.9 cm (cone-1) ' +
      'and 3.3 cm (cone-2) from its footprint. A touch of a cone or the dock wall ends the run (endOnContact). Two ways round the ' +
      'distance check fail: the tape runs on to y 137, 1 cm before the dock wall, so a follower that stops when it loses the tape meets ' +
      'the wall first; and the start moves up to 15 cm along the start straight (startJitterAlongCm; the seed 3225 puts variant 1 13.8 ' +
      'cm back and variant 2 14.2 cm on), farther than the dock is long (23 cm), so a follower stopped after a fixed time misses the ' +
      'dock in some variant whatever the time (exploits below; the spike swept the count of a timed follower from 240 000 to 380 000 ' +
      'loops and none passed). The cones are placed for this kit: a wider robot (track, wheel width) needs them moved out. Blind: three ' +
      'legs at 50 % (5200, 3150, 4200 ms) with spins of 415 ms, found by a grid search on variant 0: share 0.954, parked at 14.4 s, 1.5 ' +
      'cm from cone-2. In variant 1 (turned −3.2°, 13.8 cm back) it hits cone-2 and the run ends (0); in variant 2 (turned +4.7°, 14.2 ' +
      'cm on) it leaves the line (share 0.28) but parks (60): the check gives it 0.',
    exploits: [
      {
        name: 'follower-without-distance',
        description:
          'The follower of lesson 4 ("else stop") with no ultrasonic: it stops only when it loses the tape, and the tape runs on to the dock ' +
          'wall, so it meets the wall first and the run ends there (endOnContact). It keeps the route and the line.',
        program: workspace(hat('stem_forever', [ifBlock('if-line', followLine('line'), [stop('lost')])])),
        maxScore: 45,
      },
      {
        name: 'timed-follower',
        description:
          'The follower of lesson 4 repeated 300 000 times, then stop: the loop takes about 13.9 s, which parks in the dock in variant 0. ' +
          'The start moves up to 15 cm along the start straight, farther than the dock is long, so no count parks in every variant (the ' +
          'spike swept 240 000 to 380 000 by 5 000: none passed, the best scored 45).',
        program: workspace(hat('stem_on_start', [repeat('timed', 300000, [ifBlock('if-line', followLine('line'))]), stop('stop')])),
        maxScore: 35,
      },
    ],
  },
};

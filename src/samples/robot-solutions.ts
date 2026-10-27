import type { robotSandboxKey, RobotTemplateKey } from './robot-keys';

// The finished programs of the robot scenarios (N18 R5.2, robot plan §4.6; tests and the scenario authors only, the app never imports
// this file). For each scored scenario of `src/samples/robot-scenarios/`:
//
//   reference  the program the lesson asks for, written as a learner would with the scenario's toolbox. It must pass every goal in every
//              variant, with a margin (R5.2b runs it through the check; R5.2a compiles it and turns its sketch into a golden of C1).
//   blind      (lessons 3-6, and N19 D4's gripper lessons 8, 9 and 11) a "blind" program: motors (and the gripper) and waits only, no
//              sensor, timed so that it solves variant 0. It must fail at least
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
  /** Lessons 3-6 (and the gripper lessons 8, 9, 11): motors, the gripper and waits only, timed for variant 0. */
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

/** N19 D4: "claw open|close" (U-35): 0° open, 80° closed, where the jaws meet. */
export const claw = (id: string, state: 'OPEN' | 'CLOSE'): Json => ({ type: 'uno_gripper_claw', id, fields: { STATE: state } });
/** N19 D4: "claw angle <angle> °" (U-35), the number in the toolbox's shadow. */
export const clawAngle = (id: string, angle: number): Json => ({ type: 'uno_gripper_claw_angle', id, inputs: { ANGLE: shadowNumber(`${id}-angle`, angle) } });
/** N19 D4: "arm up|down" (U-36): 90° up, 0° down. */
export const lift = (id: string, state: 'UP' | 'DOWN'): Json => ({ type: 'uno_gripper_lift', id, fields: { STATE: state } });
/** N19 D4: "arm angle <angle> °" (U-36), the number in the toolbox's shadow. */
export const liftAngle = (id: string, angle: number): Json => ({ type: 'uno_gripper_lift_angle', id, inputs: { ANGLE: shadowNumber(`${id}-angle`, angle) } });
/** N19 D4: "object between the jaws?" (U-37), the IR sensor between the jaws. */
export const irDetect = (id: string): Json => ({ type: 'uno_ir_detect', id });
/** N19 D4: "object colour is <colour>?" (U-38), the colour sensor on the carriage. */
export const colorIs = (id: string, color: 'red' | 'green' | 'blue' | 'yellow' | 'white' | 'black' | 'unknown'): Json => ({ type: 'uno_color_is', id, fields: { COLOR: color } });
/** N19 D4: "<a> or <b>" (U-10). */
export const or = (id: string, a: Json, b: Json): Json => ({ type: 'logic_operation', id, fields: { OP: 'OR' }, inputs: { A: { block: a }, B: { block: b } } });
/** N19 D4: "not <a>" (U-10). */
export const not = (id: string, a: Json): Json => ({ type: 'logic_negate', id, inputs: { BOOL: { block: a } } });

/** N19 D4: "while <condition>" (U-13). */
export function whileBlock(id: string, condition: Json, body: readonly Json[]): Json {
  const DO = statements(body);
  return { type: 'ybc_while', id, inputs: { COND: { block: condition }, ...(DO ? { DO } : {}) } };
}

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

// --- N19 D4: the gripper car's lessons 8-11 (ref-uno-gripper@0) -------------------------------------------------------------------------
//
// PLACEHOLDER KIT. Every time and distance below is for `ref-uno-gripper@0`, whose mechanics are placeholders like the rover's
// (src/core/hardware/kits/README.md; spikes/n19-d4/results.md measured them): 13.2 cm/s at 50 %, 20.0 at 60 % and 27.0 at 70 % once moving; a
// spin at 50 % turns about 103°/s (830 ms is 82°, 900 ms is 91.5°, where the rover's 830 ms was 90°); it stops within 0.3 cm of where it
// is told to. The arm takes 0.15 s from 90° to 0° and the claw holds a 4 cm cube 0.04 s after "claw close". The IR between the jaws sees a
// cube centred 12.55 cm ahead of the robot's middle (its near face 2 cm from the sensor); held, the cube rides 12.3 cm ahead at the arm's 0°
// and 11.65 cm ahead at 90°. When the vendor's gripper replaces it (plan VG) the timed parts (the turns, the carries and every blind
// program) must be measured again and the scenarios' `version` raised.
//
// What the gripper car's sensors cannot do, and the programs respect (plan §4.11, §4.12):
//   - the ultrasonic hears the claw servo at the arm's 8-40° and the carriage at 41-52° (it reads 2 cm), so a program reads it with the arm
//     at 0° (after the 0.15 s the arm takes to come down: "arm down" then a wait) or at 80-90° while it holds a cube; a 4 cm cube is heard
//     only by the cone's lower edge, from 18.7 cm, and not at all once it is between the jaws (the cone's blind spot near the jaws);
//   - a cube 1.5 cm or more off the robot's axis is pushed ahead by a finger (4.8-33 cm) and turns the robot (up to 9.4°) before the IR sees it
//     and the jaws catch it (spikes/n19-d4 capture): the lessons keep the cube within 1 cm of the axis (sort: 19 cm ahead) or measure
//     where to put it down from a wall (pick), not from where it was caught.

/** The arm down and the claw open, then the 300 ms the arm needs to be down before the ultrasonic hears past the gripper. */
const readyToGrab = (prefix: string): Json[] => [lift(`${prefix}-arm-down`, 'DOWN'), claw(`${prefix}-claw-open`, 'OPEN'), wait(`${prefix}-arm-wait`, 300)];
/** Stop, close the claw, lift the arm (up, or to `liftDeg`). */
const gripAndLift = (prefix: string, liftDeg?: number): Json[] => [
  stop(`${prefix}-stop`),
  claw(`${prefix}-close`, 'CLOSE'),
  wait(`${prefix}-close-wait`, 300),
  liftDeg === undefined ? lift(`${prefix}-up`, 'UP') : liftAngle(`${prefix}-up`, liftDeg),
  wait(`${prefix}-up-wait`, 300),
];
/** Stop, lower the arm and open the claw: the cube is put down where it is. */
const putDown = (prefix: string): Json[] => [stop(`${prefix}-stop`), lift(`${prefix}-down`, 'DOWN'), wait(`${prefix}-down-wait`, 300), claw(`${prefix}-open`, 'OPEN'), wait(`${prefix}-open-wait`, 300)];
/** "while not object between the jaws?" with `body`. */
const untilInJaws = (id: string, body: readonly Json[] = []): Json => whileBlock(id, not(`${id}-not`, irDetect(`${id}-ir`)), body);
/** "ultrasonic distance (cm) > <cm>". */
const fartherThan = (id: string, cm: number): Json => compare(id, 'GT', ultrasonic(`${id}-distance`), numberBlock(`${id}-cm`, cm));
/** "while a line sensor sees the line" with the lesson 4 follower in it: it ends where the tape does. */
const followToLineEnd = (prefix: string): Json =>
  whileBlock(
    `${prefix}-on-line`,
    or(`${prefix}-any`, lineDark(`${prefix}-left`, 'lineLeft'), or(`${prefix}-any-2`, lineDark(`${prefix}-center`, 'lineCenter'), lineDark(`${prefix}-right`, 'lineRight'))),
    [ifBlock(`${prefix}-follow`, followLine(`${prefix}-line`))],
  );

/**
 * Lesson 8's drop: the far wall's distance at which the cube is put down, cm. The cube lands at x 137.8 (drop zone x 108..148), and a cube a
 * finger shoved deep into the zone before the IR caught it (3.3 cm off the axis: the robot then catches it at x 115) is still carried 10 cm,
 * a carry (minCarryCm 5); at 45 cm that cube was put down where it was caught, pushed (review I1).
 */
const PICK_DROP_CM = 35;
/** Lesson 8: find the cube with the ultrasonic, catch it with the IR, lift it, carry it until the far wall is 35 cm off, put it down. */
const gripPickReference = workspace(
  hat('stem_on_start', [
    ...readyToGrab('ready'),
    drive('approach', 'forward', CRUISE),
    whileBlock('to-cube', fartherThan('cube-far', 15), []),
    drive('slow', 'forward', CRUISE),
    untilInJaws('to-jaws'),
    ...gripAndLift('grab'),
    drive('carry', 'forward', 60),
    whileBlock('to-drop', fartherThan('wall-far', PICK_DROP_CM), []),
    ...putDown('put'),
    drive('back', 'backward', CRUISE),
    wait('back-time', 1000),
    stop('done'),
  ]),
);

/** Lesson 9, one parcel from the line to the warehouse and back: turn left with it, carry it, put it down, back, turn right to the line. */
const deliverParcel = (turnMs: number, carryMs: number): Json[] => [
  ...gripAndLift('grab'),
  drive('turn', 'spinLeft', CRUISE),
  wait('turn-time', turnMs),
  drive('carry', 'forward', CRUISE),
  wait('carry-time', carryMs),
  ...putDown('put'),
  drive('back', 'backward', CRUISE),
  wait('back-time', carryMs),
];
/** A spin turn of about 90° at 50 % on the placeholder gripper car (91.5°, measured). */
const GRIPPER_TURN_MS = 900;

const gripDeliverReference = workspace(
  hat('stem_on_start', [
    lift('arm-down', 'DOWN'),
    claw('claw-open', 'OPEN'),
    repeat('parcels', 3, [
      untilInJaws('to-parcel', [ifBlock('follow', followLine('line'))]),
      ...deliverParcel(GRIPPER_TURN_MS, 2200),
      drive('find', 'spinRight', CRUISE),
      whileBlock('to-line', not('off-line', lineDark('find-center', 'lineCenter')), []),
    ]),
    stop('done'),
  ]),
);

/** One timed leg and a parcel of the blind lesson 9 program: the leg's wait, the reference's moves, and a timed turn back. */
const blindParcel = (n: number, legMs: number): Json[] => [
  drive(`leg-${n}`, 'forward', CRUISE),
  wait(`leg-${n}-time`, legMs),
  ...gripAndLift(`grab-${n}`),
  drive(`turn-${n}`, 'spinLeft', CRUISE),
  wait(`turn-${n}-time`, GRIPPER_TURN_MS),
  drive(`carry-${n}`, 'forward', CRUISE),
  wait(`carry-${n}-time`, 2200),
  ...putDown(`put-${n}`),
  drive(`back-${n}`, 'backward', CRUISE),
  wait(`back-${n}-time`, 2200),
  drive(`return-${n}`, 'spinRight', CRUISE),
  wait(`return-${n}-time`, GRIPPER_TURN_MS),
];

/** Lesson 10: catch the cube, lift it, read its colour; red: left (the red zone, north), blue: right (south), else straight on (green). */
const gripSortReference = workspace(
  hat('stem_on_start', [
    ...readyToGrab('ready'),
    drive('go', 'forward', CRUISE),
    untilInJaws('to-cube'),
    ...gripAndLift('grab'),
    ifBlock('which-zone', [
      [colorIs('is-red', 'red'), [drive('to-red', 'spinLeft', CRUISE), wait('to-red-time', GRIPPER_TURN_MS)]],
      [colorIs('is-blue', 'blue'), [drive('to-blue', 'spinRight', CRUISE), wait('to-blue-time', GRIPPER_TURN_MS)]],
    ]),
    drive('carry', 'forward', CRUISE),
    wait('carry-time', 3000),
    ...putDown('put'),
    drive('back', 'backward', CRUISE),
    wait('back-time', 1000),
    stop('done'),
  ]),
);
/** Lesson 10 with `turn` after the grab in place of the reference's colour test (an exploit's), carried and put down as the reference does. */
const sortWith = (turn: readonly Json[]): BlocklyJson =>
  workspace(
    hat('stem_on_start', [
      ...readyToGrab('ready'),
      drive('go', 'forward', CRUISE),
      untilInJaws('to-cube'),
      ...gripAndLift('grab'),
      ...turn,
      drive('carry', 'forward', CRUISE),
      wait('carry-time', 3000),
      ...putDown('put'),
      drive('back', 'backward', CRUISE),
      wait('back-time', 1000),
      stop('done'),
    ]),
  );

/** The height lesson 11 carries the red cube at: its bottom 4.46 cm up, over the 4 cm base (at 45° it clips the base: ADR 0004 §4.2). */
const STACK_LIFT_DEG = 55;
/** Lesson 11 up to the carry: follow the tape until the IR sees the red cube, grip it, lift it to `liftDeg`. */
const stackGrab = (liftDeg: number): Json[] => [
  ...readyToGrab('ready'),
  untilInJaws('to-cube', [ifBlock('follow', followLine('line'))]),
  ...gripAndLift('grab', liftDeg),
];
/** Lesson 11 to the end of the tape, then stopped and still for 300 ms. */
const stackToEnd: readonly Json[] = [followToLineEnd('to-end'), stop('at-end'), wait('at-end-wait', 300)];

const gripStackReference = workspace(
  hat('stem_on_start', [
    ...stackGrab(STACK_LIFT_DEG),
    ...stackToEnd,
    claw('let-go', 'OPEN'),
    wait('let-go-wait', 500),
    drive('back', 'backward', CRUISE),
    wait('back-time', 1000),
    stop('done'),
  ]),
);

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
      'short of the zone. stop-near-wall is judged at the end of the run, with the robot at 0.5 cm/s at most for the last second, so a ' +
      'crawl through the zone (33 %, about 1.5 cm/s) is not a stop.',
    exploits: [
      {
        name: 'crash-and-back-off',
        description:
          'Forward until it runs into the wall, back for 1.1 s, stop: the wall is the same in every variant, so backing off a fixed time ' +
          'parks in the zone wherever it started. The run ends at the crash (endOnContact), so it parks nowhere.',
        program: workspace(hat('stem_on_start', [drive('go', 'forward', CRUISE), wait('drive-time', 10000), drive('back', 'backward', CRUISE), wait('back-time', 1100), stop('stop')])),
        maxScore: 0,
      },
      {
        name: 'dash-then-creep',
        description:
          'Forward at 50 % for 6070 ms, then at 33 % (a crawl of about 1.5 cm/s) for the rest of the run: it creeps through the zone and ' +
          'on into the wall. stop-in-zone wants the robot stopped (0.5 cm/s at most) in the zone at the end, so the crawl never counts.',
        program: workspace(hat('stem_on_start', [drive('dash', 'forward', CRUISE), wait('dash-time', 6070), drive('creep', 'forward', 33)])),
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
      'where the body runs into the gate at 5.65 s and the run ends, and variant 2 17.3 cm back, where it stops 7.8 cm short. ' +
      'stop-at-gate is judged at the end of the run (0.5 cm/s at most for the last second), so a creep through the zone with the flag ' +
      'up keeps only the flag.',
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
      {
        name: 'flag-dash-then-creep',
        description:
          'The flag up, forward at 50 % for 5300 ms, then at 33 % for the rest of the run: the flag is up while it creeps through the zone, ' +
          'but it never stops there (0.5 cm/s at most at the end) and creeps on into the gate.',
        program: workspace(hat('stem_on_start', [servo('flag-up', 160), drive('dash', 'forward', CRUISE), wait('dash-time', 5300), drive('creep', 'forward', 33)])),
        maxScore: 40,
      },
    ],
  },
  'rb-mini-mission': {
    reference: workspace(hat('stem_forever', [ifBlock('if-mission', [[closerThan('near', 15), [stop('stop')]], ...followLine('line')])])),
    blind: workspace(hat('stem_on_start', [...leg('leg-1', 5200, 415), ...leg('leg-2', 3150, 415), ...leg('leg-3', 4200), stop('stop')])),
    notes:
      'Reference: the follower of lesson 4 under the stop of lesson 3. Share on the tape 1.000 in all three variants; it parks at x ' +
      '141.2, y 115.8..115.9 by 13.3..15.4 s (finish-within 35 s: the same program at 40 % parks by 26.6..31.1 s) and passes the cones at 2.9 cm (cone-1) ' +
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
        // 45 since C2 (was 35): contract 0.1.7 charges motorSet 43.6875 µs, so the counted loop runs longer and hits the obstacle in every variant.
        maxScore: 45,
      },
      {
        name: 'timed-follower-creep',
        description:
          'The timed follower, then 6 s at 33 % and a stop: the crawl moves every variant\'s stop the same way, so one still misses the dock ' +
          'or meets the dock wall, which ends the run before the robot is stopped in the dock.',
        program: workspace(
          hat('stem_on_start', [repeat('timed', 300000, [ifBlock('if-line', followLine('line'))]), drive('creep', 'forward', 33), wait('creep-time', 6000), stop('stop')]),
        ),
        maxScore: 45,
      },
      {
        name: 'timed-follower-creep-forever',
        description: 'The timed follower, then 33 % for the rest of the run: it creeps through the dock, never stopped, into the dock wall.',
        program: workspace(hat('stem_on_start', [repeat('timed', 300000, [ifBlock('if-line', followLine('line'))]), drive('creep', 'forward', 33)])),
        maxScore: 45,
      },
      {
        name: 'follower-bump-and-back',
        description:
          'The follower of lesson 4 at 40 % that, once it loses the tape, backs off for 500 ms and stops: the tape runs on to the dock ' +
          'wall, so it meets the wall first and the run ends there.',
        program: workspace(
          hat('stem_forever', [
            ifBlock(
              'if-line',
              [
                [lineDark('bump-center', 'lineCenter'), [drive('bump-forward', 'forward', 40)]],
                [lineDark('bump-left', 'lineLeft'), [drive('bump-spin-left', 'spinLeft', 40)]],
                [lineDark('bump-right', 'lineRight'), [drive('bump-spin-right', 'spinRight', 40)]],
              ],
              [drive('back', 'backward', CRUISE), wait('back-time', 500), stop('stop'), wait('latch', 60000)],
            ),
          ]),
        ),
        maxScore: 45,
      },
    ],
  },
  // N19 D4: the gripper car's lessons (plan §6), measured with spikes/n19-d4 through the real check (results.md); every speed 50 % or more
  // (G0 start duty: the gripper car starts from rest with 50 g held from duty 128).
  'rb-grip-pick': {
    reference: gripPickReference,
    blind: workspace(
      hat('stem_on_start', [
        ...readyToGrab('ready'),
        drive('go', 'forward', CRUISE),
        wait('go-time', 3300),
        ...gripAndLift('grab'),
        drive('carry', 'forward', 60),
        wait('carry-time', 2300),
        ...putDown('put'),
        drive('back', 'backward', CRUISE),
        wait('back-time', 1000),
        stop('done'),
      ]),
    ),
    notes:
      'Reference: the arm down and the claw open, a 300 ms wait for the arm (the ultrasonic hears the claw servo and the carriage while the ' +
      'arm passes 8-52°), forward at 50 % until the ultrasonic hears the cube under 15 cm (only the cone\'s lower edge hears a 4 cm cube, from ' +
      '18.7 cm), on until the IR sees it between the jaws (its middle 12.55 cm ahead), close, lift, carry at 60 % with the arm up (the cone is ' +
      'clear at 90° with a cube held) until the far wall is under 35 cm, put down, back off. In seed 23\'s variants (the cube 9.3 cm on and ' +
      '10.0 cm back, the start turned 1.3° and −1.9°) the cube lands at x 137.3..137.5 (drop zone x 108..148). The variants put the cube up to ' +
      '3.3 cm off the robot\'s line of travel (start ±1 cm and ±2°, the cube 66 cm ahead at most); from about 2.5 cm the ultrasonic never ' +
      'hears it and a finger shoves it on, as far as x 127 with the robot at x 115, before the IR catches it. Put down at 35 cm from the wall ' +
      'that cube is still carried 10 cm; at 45 cm it was carried under 5 cm and scored pushed, and at 70 % a cube 2.6-2.9 cm off failed ' +
      'too (review 1 I1). Measured: every corner of the variant range (16, up to 3.3 cm off) and 77 other jittered draws (seeds 100-159, ' +
      '1000-8000; up to 2.86 cm off) score 100. Blind: forward 3300 ms at 50 % (it catches the cube of variant 0 at x 72.9), carry 2300 ms ' +
      'at 60 %: it passes variant 0 and closes on nothing in variant 1 (the cube 9.3 cm farther) and pushes the nearer cube of variant 2 ' +
      'into the carriage, where the claw cannot take it: 15 in both. Placeholder kit: the 35 cm and the blind timings are the placeholder car\'s.',
    exploits: [
      {
        name: 'never-lower-arm',
        description:
          'The reference with the arm left up: the jaws pass over the cube and the IR never sees it, so the body pushes the cube on until the ' +
          'raised fingertips touch the far wall, which ends the run (endOnContact). Nothing is picked up.',
        program: workspace(
          hat('stem_on_start', [
            claw('claw-open', 'OPEN'),
            wait('wait', 300),
            drive('approach', 'forward', CRUISE),
            whileBlock('to-cube', fartherThan('cube-far', 15), []),
            drive('slow', 'forward', CRUISE),
            untilInJaws('to-jaws'),
            ...gripAndLift('grab'),
            drive('carry', 'forward', 60),
            whileBlock('to-drop', fartherThan('wall-far', PICK_DROP_CM), []),
            ...putDown('put'),
            drive('back', 'backward', CRUISE),
            wait('back-time', 1000),
            stop('done'),
          ]),
        ),
        maxScore: 15,
      },
      {
        name: 'push-in',
        description:
          'The arm down and the claw open, forward at 50 % for 6600 ms, pushing the cube between the open jaws into the drop zone, then back ' +
          'off: a pushed cube is never placed (object-pushed), so only the guard goal is met.',
        program: workspace(
          hat('stem_on_start', [...readyToGrab('ready'), drive('push', 'forward', CRUISE), wait('push-time', 6600), stop('stop'), drive('back', 'backward', CRUISE), wait('back-time', 1000), stop('done')]),
        ),
        maxScore: 15,
      },
      {
        name: 'hold-in-zone',
        description:
          'The reference that carries the cube over the drop zone and lowers the arm there but never opens the claw: the cube is held at the ' +
          'end (object-still-held). It keeps the grab and the guard goal.',
        program: workspace(
          hat('stem_on_start', [
            ...readyToGrab('ready'),
            drive('approach', 'forward', CRUISE),
            whileBlock('to-cube', fartherThan('cube-far', 15), []),
            drive('slow', 'forward', CRUISE),
            untilInJaws('to-jaws'),
            ...gripAndLift('grab'),
            drive('carry', 'forward', 60),
            whileBlock('to-drop', fartherThan('wall-far', PICK_DROP_CM), []),
            stop('hold'),
            lift('arm-down', 'DOWN'),
          ]),
        ),
        maxScore: 55,
      },
      {
        name: 'push-closed-then-lift',
        description:
          'Review 1 M1: the arm down and the claw closed, forward at 50 % for 5600 ms, shoving the cube ahead of the closed jaws into the drop ' +
          'zone (x 117 and 138 in variants 0 and 1); there the claw opens, the car creeps on until the IR sees the cube, grips it, lifts it in ' +
          'place (900 ms up) and puts it down where it is. A lift in place is no carry (5 cm while lifted: minCarryCm), so place-cube reads ' +
          'object-pushed; the grab and the guard stay (55). In variant 2 the closed jaws lose the cube and the car creeps into the far wall (0).',
        program: workspace(
          hat('stem_on_start', [
            lift('arm-down', 'DOWN'),
            claw('claw-closed', 'CLOSE'),
            wait('arm-wait', 300),
            drive('push', 'forward', CRUISE),
            wait('push-time', 5600),
            stop('in-zone'),
            claw('open', 'OPEN'),
            wait('open-wait', 300),
            drive('creep', 'forward', CRUISE),
            untilInJaws('to-jaws'),
            stop('at-cube'),
            claw('close', 'CLOSE'),
            wait('close-wait', 300),
            lift('up', 'UP'),
            wait('up-wait', 900),
            ...putDown('put'),
            drive('back', 'backward', CRUISE),
            wait('back-time', 1000),
            stop('done'),
          ]),
        ),
        maxScore: 55,
      },
    ],
  },
  'rb-grip-deliver': {
    reference: gripDeliverReference,
    blind: workspace(hat('stem_on_start', [...readyToGrab('ready'), ...blindParcel(1, 2800), ...blindParcel(2, 1900), ...blindParcel(3, 1900), stop('done')])),
    notes:
      'Reference: three times, the follower of lesson 4 (arm down, claw open) until the IR sees the parcel on the tape, grip and lift, a ' +
      'spin left of 900 ms (91.5° on the placeholder car, not the rover\'s 830 ms), 2200 ms on at 50 %, put down, as far back, and a spin ' +
      'right until the centre sensor sees the tape again. The parcels land at x 76..79 (warehouse x 62..100), 15 cm south of where they lay, ' +
      'hence the warehouse\'s y 40..125 for parcels at y 70, 95 and 120; it scores 97 in every variant (the bonus 7: done by 26 s of 90). The ' +
      'seed (430) moves the start 5.4 cm back and 5.1 cm on along the tape and turns it −4.9° and +3.5°, and moves each parcel up to 5 cm ' +
      'along the tape, both ways. Blind: the reference\'s moves on timed legs (2800, 1900, 1900 ms) and a timed turn back: it passes ' +
      'variant 0 (97) and pushes a parcel it reaches early or misses one it reaches late in the others: 40. Placeholder kit: the turn and ' +
      'the carry are the placeholder car\'s: the turn passes at 800-1000 ms and the carry at 1200 ms, and a carry of 3200 ms hits the shelf ' +
      '(review 1), so the carry has less than 1 s on its long side.',
    exploits: [
      {
        name: 'push-north',
        description:
          'The arm down and the claw open, the follower of lesson 4 repeated 60 000 times: it shoves the parcels up the tape and never takes ' +
          'one to the warehouse. Each is pushed, so only the guard goal is met.',
        program: workspace(
          hat('stem_on_start', [
            ...readyToGrab('ready'),
            repeat('shove', 60000, [ifBlock('follow', followLine('line'))]),
            stop('stop'),
            drive('back', 'backward', CRUISE),
            wait('back-time', 1000),
            stop('done'),
          ]),
        ),
        maxScore: 15,
      },
      {
        name: 'open-jaw-sweep-lift',
        description:
          'D2 review N1: at each parcel the claw only to 10° (nearly open), the turn and the drive into the warehouse, which sweeps the parcel ' +
          'along (the turn presses it into a finger, which takes it at the arm\'s 0°: a drag on the floor, or it is flung out), there "claw ' +
          'close" and the arm to 14° (the parcel 1 cm up, in place), down, open, back to the tape. A lift in place is no carry (5 cm while ' +
          'lifted: minCarryCm), so every parcel is pushed.',
        program: workspace(
          hat('stem_on_start', [
            lift('arm-down', 'DOWN'),
            claw('claw-open', 'OPEN'),
            repeat('parcels', 3, [
              untilInJaws('to-parcel', [ifBlock('follow', followLine('line'))]),
              stop('at-parcel'),
              clawAngle('nearly-open', 10),
              drive('turn', 'spinLeft', CRUISE),
              wait('turn-time', GRIPPER_TURN_MS),
              drive('sweep', 'forward', CRUISE),
              wait('sweep-time', 2200),
              stop('in-warehouse'),
              claw('close', 'CLOSE'),
              wait('close-wait', 300),
              liftAngle('lift-1cm', 14),
              wait('lift-wait', 500),
              lift('lower', 'DOWN'),
              wait('lower-wait', 300),
              claw('open', 'OPEN'),
              wait('open-wait', 300),
              drive('back', 'backward', CRUISE),
              wait('back-time', 2200),
              drive('find', 'spinRight', CRUISE),
              whileBlock('to-line', not('off-line', lineDark('find-center', 'lineCenter')), []),
            ]),
            stop('done'),
          ]),
        ),
        maxScore: 15,
      },
    ],
  },
  'rb-grip-sort': {
    reference: gripSortReference,
    notes:
      'Reference: catch the cube 19 cm ahead with the IR, lift it, read its colour (the sensor between the jaws sees the held cube 1.7 cm ' +
      'off), then a spin of 900 ms left for red or right for blue, or none for anything else, 3000 ms at 50 %, put down, back off. The cube ' +
      'lands at (88, 75) green, (33.9, 128.7) red, (33.8, 21.4) blue: the middle of each zone. Every variant starts from the same place ' +
      'with the cube at the same place, only its colour changes (green, red, blue: objectColors), so only a program that reads the colour ' +
      'passes all three; the seed (8) turns the start −2.3° and +2.9°. The cube is 19 cm ahead so that a 3° turn leaves it within 1 cm of ' +
      'the axis, where the jaws take it without pushing it first (at 32 cm, a 2.9° turn pushed it 15.8 cm and the straight carry left it ' +
      'out of the green zone). No blind program: the colours are the variants. Placeholder kit: the turn and the carry are the placeholder car\'s; ' +
      'the turn passes only at 800-1000 ms (±10°; it fails at 750 and 1050 ms, review 1), the tightest timed part of the four lessons.',
    exploits: [
      {
        name: 'always-turn-left',
        description: 'Catch and lift the cube, then always the red zone\'s left turn, whatever the colour: the green and the blue cube end in the red zone.',
        program: sortWith([drive('to-red', 'spinLeft', CRUISE), wait('to-red-time', GRIPPER_TURN_MS)]),
        maxScore: 40,
      },
      {
        name: 'only-check-red',
        description: 'Left for red and straight on for anything else: the blue cube ends in the green zone.',
        program: sortWith([ifBlock('if-red', [[colorIs('is-red', 'red'), [drive('to-red', 'spinLeft', CRUISE), wait('to-red-time', GRIPPER_TURN_MS)]]])]),
        maxScore: 40,
      },
    ],
  },
  'rb-grip-stack': {
    reference: gripStackReference,
    blind: workspace(
      hat('stem_on_start', [
        ...readyToGrab('ready'),
        drive('go', 'forward', CRUISE),
        wait('go-time', 3700),
        ...gripAndLift('grab', STACK_LIFT_DEG),
        drive('carry', 'forward', CRUISE),
        wait('carry-time', 4700),
        stop('at-base'),
        wait('at-base-wait', 300),
        claw('let-go', 'OPEN'),
        wait('let-go-wait', 500),
        drive('back', 'backward', CRUISE),
        wait('back-time', 1000),
        stop('done'),
      ]),
    ),
    notes:
      'Reference: the follower of lesson 4 until the IR sees the red cube on the tape, grip it, the arm to 55° (G0 ruling: at 45° the cube ' +
      'clips the 4 cm base and shoves it), the follower again to the end of the tape, stop, open: the robot stops at x 144.5 in every variant ' +
      'with the cube 0.46 cm over the base, which it lands on 0.11..0.19 cm off its middle (allowed 1.5), the base unmoved. 97 in every ' +
      'variant (the bonus 7). The ultrasonic is no use while carrying (a cube held at 55-70° blocks it): the end of the tape tells where. ' +
      'The seed (217) moves the start 12.0 cm back and 9.4 cm on along the tape and the cube 3.5 cm on and 3.7 cm back. Blind: forward ' +
      '3700 ms, the arm to 55°, 4700 ms on: it stacks in variant 0 (97), closes before the cube of variant 1, and in variant 2 pushes the ' +
      'base with the body (75): 15. Placeholder kit: the 55° and the stop at the end of the tape are the placeholder car\'s geometry.',
    exploits: [
      {
        name: 'place-beside-base',
        description: 'Grip, the arm to 55°, 3000 ms along the tape, then the arm down and the claw open: the cube is put down on the floor short of the base.',
        program: workspace(
          hat('stem_on_start', [...stackGrab(STACK_LIFT_DEG), drive('carry', 'forward', CRUISE), wait('carry-time', 3000), ...putDown('put'), drive('back', 'backward', CRUISE), wait('back-time', 1000), stop('done')]),
        ),
        maxScore: 35,
      },
      {
        name: 'hold-over-base',
        description: 'The reference that never opens the claw: the cube is held over the base to the end (object-still-held).',
        program: workspace(hat('stem_on_start', [...stackGrab(STACK_LIFT_DEG), ...stackToEnd])),
        maxScore: 35,
      },
      {
        name: 'arm-too-low',
        description:
          'The reference with the cube carried at the arm\'s 45° instead of 55°: its bottom (3.65 cm) is under the base\'s top, so at the end ' +
          'of the tape it shoves the base on (object-moved) and lands on the floor. It keeps the grab.',
        program: workspace(
          hat('stem_on_start', [...stackGrab(45), ...stackToEnd, claw('let-go', 'OPEN'), wait('let-go-wait', 500), drive('back', 'backward', CRUISE), wait('back-time', 1000), stop('done')]),
        ),
        maxScore: 20,
      },
      {
        name: 'lower-arm-fully',
        description:
          'The reference that lowers the arm all the way (0°) at the end of the tape before it opens: the lowering stalls on the base and the ' +
          'cube slides 1.7-1.8 cm off its middle (stack-off-centre), the base unmoved (0.05 cm). A near-miss stack, held like place-beside-base ' +
          '(controller ruling D4 item B: plan §6\'s "hạ hết tay" is arm-too-low at 20 and this at 35).',
        program: workspace(
          hat('stem_on_start', [
            ...stackGrab(STACK_LIFT_DEG),
            ...stackToEnd,
            lift('lower', 'DOWN'),
            wait('lower-wait', 500),
            claw('let-go', 'OPEN'),
            wait('let-go-wait', 500),
            drive('back', 'backward', CRUISE),
            wait('back-time', 1000),
            stop('done'),
          ]),
        ),
        maxScore: 35,
      },
    ],
  },
};

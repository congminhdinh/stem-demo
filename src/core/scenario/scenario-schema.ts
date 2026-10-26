import { z } from 'zod';
import { roleKinds, robotRoles, type ModuleKind, type RobotRole } from '../hardware/kit';
import { arenaSchema, colorKey, colorSchema, sameColor } from '../world/arena/arena-schema';
import { hasHiddenCharacter, trimLikeDotNet } from './goal-text';
import { polygonsOverlap } from './polygon-overlap';
import { isRobotTemplateKey, robotLabProfiles, robotSandboxKey, robotTemplateKeys, robotTemplates } from '../../samples/robot-keys';

// The scenario of a robot lab (N18 R5.1, robot plan §4.6): the learner's task as data. The arena, the kit and where the robot
// starts; the variants a check runs; the scripted button presses; the goals and the score; the program the learner starts from
// and the blocks they may use. Authored as JSON in `src/samples/robot-scenarios/rb-*.json`, validated here when it is loaded.
// R5.2 writes the scenarios, R6 judges the goals, R4 shows the task: all of them read this one shape.
//
// Units are the arena's (arena-schema.ts): centimetres and degrees, x right, y away, yaw counter-clockwise from +x.
// Unknown keys are refused rather than dropped, as in the arena, so a typo is an error and not a silent default.
//
// Rules a shape cannot say are checked in `scenarioRuleIssues`: what a goal refers to exists in the arena (and the zones of one route
// do not overlap), the inputs are a consistent script, and the score adds up to exactly 100. Every issue names the path of the value at fault.

/** The score of every scored scenario, goal points plus the time bonus (the same top mark for every lesson). `rb-sandbox` has none. */
export const SCENARIO_MAX_SCORE = 100;

/** A scenario's title may not be longer, nor its inputs more numerous (a script is a few button presses). */
export const TITLE_MAX_CHARS = 120;
export const INPUTS_MAX = 100;
/** The longest run a scenario can ask for. A check runs every variant for this long, in the worst case, in a few seconds (plan §5). */
export const TIME_LIMIT_MAX_S = 600;
/** What the LMS stores of a goal (STEMLearning): a key of lowercase letters, digits and "-", at most 50 characters, and a label of 200. */
export const GOAL_ID_MAX_CHARS = 50;
export const GOAL_LABEL_MAX_CHARS = 200;
/** The most variants a check runs, the LMS cap on `variants` of a check result. */
export const VARIANTS_MAX = 10;
/** N18 R6.2 fix round 1: the most goals a scenario has, the LMS cap on the goals of a lab attempt (LearningService LabAttemptRules.MaxGoals). */
export const GOALS_MAX = 20;
/** N18 R6.2 fix round 1: the highest `version`, which a check result reports as a 32-bit int (`scenarioVersion`, check-result.ts). */
export const SCENARIO_VERSION_MAX = 2_147_483_647;
/** A servo turns 0..180° (the `servo-lib` driver clamps to it). */
const SERVO_DEG_MAX = 180;
const SEED_MAX = 4294967295;

const wholeFrom = (min: number, message: string) => z.number().int(message).min(min, message);
/**
 * A title or a goal label: as the LMS reads a goal text (goal-text.ts, N18 final fix M5): trimmed as .NET trims, 1 to `max` UTF-16 units,
 * and no control or format character (Unicode Cc, Cf), which LearningService refuses in every check result that carries the label.
 */
const text = (max: number) =>
  z
    .string()
    .overwrite(trimLikeDotNet)
    .min(1, 'must not be empty')
    .max(max, `at most ${max} characters`)
    .refine((value) => !hasHiddenCharacter(value), 'must not hold a control or format character (a line break, a tab, a zero-width or bidi mark)');
/** A text in both languages the UI speaks. */
const localized = (max: number) => z.strictObject({ vi: text(max), en: text(max) });

const blockTypeSchema = z.string().regex(/^[A-Za-z0-9_]+$/, 'a block type is letters, digits and "_"');
const goalIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'a goal id is lowercase letters, digits and "-"')
  .max(GOAL_ID_MAX_CHARS, `a goal id is at most ${GOAL_ID_MAX_CHARS} characters`);
const pointsSchema = wholeFrom(0, 'must be a whole number, 0 or more');
const positive = z.number().positive('must be more than 0');
const servoDeg = z.number().min(0, `must be from 0 to ${SERVO_DEG_MAX}`).max(SERVO_DEG_MAX, `must be from 0 to ${SERVO_DEG_MAX}`);
const lengthCm = z.number().min(0, 'must be 0 or more');
/** N19 D2: how far an object may lean, degrees (frame.ts `tiltDeg`). */
const TILT_DEG_MAX = 90;
const tiltDeg = z.number().min(0, `must be from 0 to ${TILT_DEG_MAX}`).max(TILT_DEG_MAX, `must be from 0 to ${TILT_DEG_MAX}`);

const goalBase = { id: goalIdSchema, label: localized(GOAL_LABEL_MAX_CHARS), points: pointsSchema };

/**
 * The N18 kinds of goal only, the ones the schema fixture (all-goals.scenario.json) has one of each of. Every kind a scenario can have is
 * `allGoalKinds` (N19 D1–D3 fix round 1, review M9: scenario-schema.pick-place.test.ts holds it to the schema's union at compile time).
 */
export const goalKinds = [
  'reach-zone',
  'checkpoints-in-order',
  'stay-on-line',
  'avoid-contact',
  'object-in-zone',
  'stop-in-zone',
  'servo-angle',
  'finish-within',
  'uses-block',
] as const;

/**
 * N19 D2 (plan §4.5): the kinds of goal about an object the robot picks up and puts down, which read the gripper's side of the goal frame
 * (frame.ts `held`, `zCm`, `tiltDeg`). Listed apart from the N18 kinds above, whose schema fixture (all-goals.scenario.json) has one of each;
 * the pick-and-place fixture (pick-place.scenario.json) has one of each of these.
 */
export const pickPlaceGoalKinds = ['object-held', 'object-placed', 'object-on-object', 'object-unmoved'] as const;

/** Every kind of goal a scenario can have: the N18 kinds, then the N19 pick-and-place ones. */
export const allGoalKinds = [...goalKinds, ...pickPlaceGoalKinds] as const;

/** What a goal asks; each kind is judged by `core/scenario/goals/<kind>.ts` (R6.1). Zones and objects are named by arena id. */
const goalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...goalBase, kind: z.literal('reach-zone'), zone: z.string() }),
  z.strictObject({ ...goalBase, kind: z.literal('checkpoints-in-order'), zones: z.array(z.string()).min(1, 'needs at least one zone') }),
  z.strictObject({
    ...goalBase,
    kind: z.literal('stay-on-line'),
    minRatio: z.number().gt(0, 'must be more than 0 and at most 1').max(1, 'must be more than 0 and at most 1'),
  }),
  z.strictObject({ ...goalBase, kind: z.literal('avoid-contact'), tag: z.string().min(1, 'must not be empty') }),
  z.strictObject({ ...goalBase, kind: z.literal('object-in-zone'), object: z.string(), zone: z.string() }),
  z.strictObject({ ...goalBase, kind: z.literal('stop-in-zone'), zone: z.string(), maxSpeedCmS: positive, holdS: positive }),
  z.strictObject({
    ...goalBase,
    kind: z.literal('servo-angle'),
    role: z.string(),
    minDeg: servoDeg,
    maxDeg: servoDeg,
    whenInZone: z.string().optional(),
  }),
  z.strictObject({ ...goalBase, kind: z.literal('finish-within'), seconds: positive }),
  z.strictObject({ ...goalBase, kind: z.literal('uses-block'), blockType: z.string() }),
  // N19 D2 (plan §4.5): goals/<kind>.ts says what each asks; the defaults are the plan's.
  z.strictObject({ ...goalBase, kind: z.literal('object-held'), object: z.string(), holdS: positive.default(0.5), minLiftCm: lengthCm.default(0) }),
  z.strictObject({
    ...goalBase,
    kind: z.literal('object-placed'),
    object: z.string(),
    /** The zone the object goes to; or, with `zoneByColor`, the zone of the colour the object has in the variant. Exactly one of the two. */
    zone: z.string().optional(),
    /** By colour ("#rrggbb", any case): the keys are checked with the rules, so that a bad one is named like a bad colour anywhere. */
    zoneByColor: z.record(z.string(), z.string()).optional(),
    fully: z.boolean().default(true),
    maxTiltDeg: tiltDeg.default(15),
    restS: positive.default(0.5),
    carried: z.boolean().default(true),
    maxSlideCm: lengthCm.default(3),
    /** N19 D1–D3 fix round 1 (review I1): how high a grip must have lifted the object, cm, for it to have been carried (a pinch is not). */
    minCarryLiftCm: lengthCm.default(1),
    /** N19 D1–D3 fix round 2 (review N1): how far the grip must have taken it on the floor while it was that high, cm (a lift in place is not). */
    minCarryCm: lengthCm.default(5),
  }),
  z.strictObject({
    ...goalBase,
    kind: z.literal('object-on-object'),
    top: z.string(),
    bottom: z.string(),
    maxOffsetCm: lengthCm,
    maxTiltDeg: tiltDeg,
    restS: positive,
    carried: z.boolean().default(true),
    /** As for object-placed: how high a grip must have lifted the top, cm, and how far it must have taken it that high, for a carry. */
    minCarryLiftCm: lengthCm.default(1),
    minCarryCm: lengthCm.default(5),
  }),
  z.strictObject({ ...goalBase, kind: z.literal('object-unmoved'), object: z.string(), maxMoveCm: lengthCm, maxTiltDeg: tiltDeg.default(20) }),
], {
  error: (issue) => `unknown goal kind ${JSON.stringify((issue.input as { kind?: unknown } | null)?.kind)}; the kinds are ${allGoalKinds.join(', ')}`,
});

/** Where the robot starts: the point of the floor under the middle of its body, and its heading. */
const poseSchema = z.strictObject({ xCm: z.number(), yCm: z.number(), yawDeg: z.number() });

const variantsSchema = z.strictObject({
  /** Variants a check runs, from 1; variant 0 is always the exact start. */
  count: wholeFrom(1, `must be a whole number from 1 to ${VARIANTS_MAX}`).max(VARIANTS_MAX, `must be a whole number from 1 to ${VARIANTS_MAX}`),
  /** The seed of the jitter; each variant derives its own from it (variants.ts). */
  seed: wholeFrom(0, `must be a whole number from 0 to ${SEED_MAX}`).max(SEED_MAX, `must be a whole number from 0 to ${SEED_MAX}`),
  /** How far the start may move, each way, in x and y; across its heading only when `startJitterAlongCm` is given. */
  startJitterCm: z.number().min(0, 'must be 0 or more'),
  /**
   * N18 R5.2a fix round 2: how far the start may move, each way, along its heading (the start straight of a line follower), when it may
   * move farther that way than across it. Left out: the start moves by `startJitterCm` in x and y.
   */
  startJitterAlongCm: z.number().min(0, 'must be 0 or more').optional(),
  yawJitterDeg: z.number().min(0, 'must be from 0 to 180').max(180, 'must be from 0 to 180'),
  /** How far the arena boxes and cylinders tagged `jitter` may move, each way along x and y. */
  obstacleJitterCm: z.number().min(0, 'must be 0 or more').optional(),
  /**
   * N19 D1 (plan §4.5): the arena objects a variant moves, and how far each way along x and y. Each entry is one draw (variants.ts) that
   * moves all of its objects together, so a row of parcels keeps its spacing; an object moves in one entry at most.
   */
  objectJitter: z
    .array(
      z.strictObject({
        objects: z.array(z.string()).min(1, 'needs at least one object'),
        dxCm: z.number().min(0, 'must be 0 or more'),
        dyCm: z.number().min(0, 'must be 0 or more'),
      }),
    )
    .min(1, 'needs at least one entry')
    .optional(),
  /**
   * N19 D1 (plan §4.5): the colour of an arena object in each variant, by its id: one colour per variant, the first the colour the arena
   * gives it (variant 0 is the arena as authored). A lesson that sorts by colour changes the colour, not the place, so a program has to read it.
   */
  objectColors: z.record(z.string(), z.array(colorSchema)).optional(),
});

const inputSchema = z.strictObject({ atS: z.number(), role: z.string(), action: z.enum(['press', 'release']) });

const scoringSchema = z.strictObject({
  /** The most a quick finish adds. How it is earned is the score's (R6.2). */
  timeBonusMax: pointsSchema.optional(),
  /** Reserved: no penalty kind is defined yet (R6.2 adds them, with their meaning). */
  penalties: z.array(z.custom<never>()).max(0, 'no penalty kind exists yet').optional(),
});

const scenarioShape = z.strictObject({
  /** A key of `src/samples/robot-keys.ts`. Never renamed or reused; a change of behaviour raises `version`. */
  key: z.string().refine(isRobotTemplateKey, {
    error: (issue) => `unknown scenario key ${JSON.stringify(issue.input)}; the keys are ${robotTemplateKeys.join(', ')}`,
  }),
  version: wholeFrom(1, 'must be a whole number from 1').max(SCENARIO_VERSION_MAX, `must be a whole number from 1 to ${SCENARIO_VERSION_MAX}`),
  title: localized(TITLE_MAX_CHARS),
  profile: z.enum(robotLabProfiles),
  kit: z.string(),
  arena: arenaSchema,
  start: poseSchema,
  variants: variantsSchema,
  /** The script of button presses, from the first to the last; sorted by time when loaded. */
  inputs: z.array(inputSchema).max(INPUTS_MAX, `at most ${INPUTS_MAX} inputs`).default([]),
  timeLimitS: z.number().positive('must be more than 0 s').max(TIME_LIMIT_MAX_S, `must be at most ${TIME_LIMIT_MAX_S} s`),
  goals: z.array(goalSchema).max(GOALS_MAX, `at most ${GOALS_MAX} goals (the LMS stores ${GOALS_MAX} a lab)`),
  scoring: scoringSchema.default({}),
  /** A Blockly workspace as `Blockly.serialization.workspaces.save` writes it (`{}` when empty): opaque here, the UI loads it. */
  starter: z.record(z.string(), z.unknown()),
  /** The block types the learner may use; every block when absent. */
  toolbox: z.array(blockTypeSchema).min(1, 'needs at least one block type').optional(),
  /**
   * N18 R5.2a fix round 2 (controller ruling): the tags (or kinds) of the colliders whose first contact ends the run, as a crash does in a
   * robot competition. The run session and the check (R3.6, R6.2) stop at that tick (`runEndingContact`, scenario.ts); the goals are judged on
   * the frames up to and including it, and a goal that needs a hold or a stop it had not yet had fails with `run-ended-contact`.
   */
  endOnContact: z.array(z.string().min(1, 'must not be empty')).min(1, 'needs at least one tag').optional(),
});

type ScenarioShape = z.output<typeof scenarioShape>;

export const scenarioSchema = scenarioShape
  .superRefine((scenario, ctx) => {
    for (const issue of scenarioRuleIssues(scenario)) {
      ctx.addIssue({ code: 'custom', ...issue });
    }
  })
  .transform((scenario) => ({ ...scenario, inputs: inTimeOrder(scenario.inputs) }));

/** A scenario as authored (defaults may be left out). */
export type ScenarioJson = z.input<typeof scenarioSchema>;
/** A validated scenario: defaults filled in, inputs sorted by time. */
export type Scenario = z.output<typeof scenarioSchema>;
export type RobotGoalSpec = Scenario['goals'][number];
export type GoalKind = RobotGoalSpec['kind'];
/** A button press or release of the script. */
export type ScenarioInput = Scenario['inputs'][number];
export type PoseCm = Scenario['start'];
/** No penalty kind exists yet (R6.2). */
export type PenaltySpec = never;

type RuleIssue = { path: (string | number)[]; message: string };

/** Stable: inputs at one instant keep the order they were written in (the kit has one button, which has one input per instant). */
function inTimeOrder(inputs: ScenarioShape['inputs']): ScenarioShape['inputs'] {
  return [...inputs].sort((a, b) => a.atS - b.atS);
}

const rolesOfKind = (kind: ModuleKind): RobotRole[] => robotRoles.filter((role) => roleKinds[role] === kind);
const list = (items: readonly string[], none: string) => (items.length > 0 ? items.join(', ') : none);

/** The rules a shape cannot say. Runs when the shape holds, so every field has its type. */
function scenarioRuleIssues(scenario: ScenarioShape): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const add = (path: (string | number)[], message: string) => issues.push({ path, message });
  const { arena } = scenario;

  // What the key stands for: the profile and the kit it is launched with (robot-keys.ts).
  if (isRobotTemplateKey(scenario.key)) {
    const template = robotTemplates[scenario.key];
    if (scenario.profile !== template.profile) {
      add(['profile'], `${scenario.key} needs the profile "${template.profile}", not "${scenario.profile}"`);
    }
    if (scenario.kit !== template.kit) {
      add(['kit'], `${scenario.key} uses the kit "${template.kit}", not "${scenario.kit}"`);
    }
  }

  const [width, depth] = arena.ground.sizeCm;
  if (scenario.start.xCm < 0 || scenario.start.xCm > width || scenario.start.yCm < 0 || scenario.start.yCm > depth) {
    add(['start'], `off the ground (x 0..${width}, y 0..${depth} cm)`);
  }

  inputIssues(scenario, add);
  variantIssues(scenario, add);
  goalIssues(scenario, add);
  endOnContactIssues(scenario, add);
  scoreIssues(scenario, add);

  if (scenario.toolbox) {
    const first = new Map<string, number>();
    scenario.toolbox.forEach((blockType, i) => {
      const earlier = first.get(blockType);
      if (earlier === undefined) first.set(blockType, i);
      else add(['toolbox', i], `"${blockType}" is already listed at toolbox[${earlier}]`);
    });
  }
  return issues;
}

type Add = (path: (string | number)[], message: string) => void;

function inputIssues(scenario: ScenarioShape, add: Add): void {
  const buttons = rolesOfKind('button');
  const valid: number[] = [];
  scenario.inputs.forEach((input, i) => {
    let ok = true;
    if (!buttons.includes(input.role as RobotRole)) {
      add(['inputs', i, 'role'], `"${input.role}" is not a button role (${buttons.join(', ')})`);
      ok = false;
    }
    if (input.atS < 0 || input.atS >= scenario.timeLimitS) {
      add(['inputs', i, 'atS'], `must be at least 0 s and before the time limit (${scenario.timeLimitS} s)`);
      ok = false;
    }
    if (ok) valid.push(i);
  });

  // A script: in time order, each button alternates press and release from released, and has one input per instant.
  const inOrder = [...valid].sort((a, b) => scenario.inputs[a]!.atS - scenario.inputs[b]!.atS || a - b);
  const state = new Map<string, { pressed: boolean; atS: number }>();
  for (const i of inOrder) {
    const input = scenario.inputs[i]!;
    const now = state.get(input.role) ?? { pressed: false, atS: Number.NaN };
    if (now.atS === input.atS) {
      add(['inputs', i, 'atS'], `${input.role} already has an input at ${input.atS} s`);
      continue;
    }
    if (input.action === 'press' && now.pressed) {
      add(['inputs', i, 'action'], `${input.role} is already pressed`);
    } else if (input.action === 'release' && !now.pressed) {
      add(['inputs', i, 'action'], `${input.role} is not pressed, so it cannot be released`);
    }
    state.set(input.role, { pressed: input.action === 'press', atS: input.atS });
  }
}

const noObjectMessage = (arena: ScenarioShape['arena'], id: string) => {
  const ids = arena.objects.map((object) => object.id);
  return `no object "${id}" in the arena (${ids.length > 0 ? `objects: ${ids.join(', ')}` : 'the arena has no objects'})`;
};

/** N19 D1: what `objectJitter` moves and what `objectColors` paints are objects of the arena, each moved once, painted once per variant. */
function variantIssues(scenario: ScenarioShape, add: Add): void {
  const { arena, variants } = scenario;
  const byId = new Map(arena.objects.map((object) => [object.id, object]));
  const movedIn = new Map<string, number>();
  variants.objectJitter?.forEach((entry, i) => {
    entry.objects.forEach((id, j) => {
      const at = ['variants', 'objectJitter', i, 'objects', j];
      if (!byId.has(id)) {
        add(at, noObjectMessage(arena, id));
        return;
      }
      const earlier = movedIn.get(id);
      if (earlier !== undefined) add(at, `"${id}" already moves in variants.objectJitter[${earlier}]`);
      else movedIn.set(id, i);
    });
  });
  for (const [id, colors] of Object.entries(variants.objectColors ?? {})) {
    const at = ['variants', 'objectColors', id];
    const object = byId.get(id);
    if (object === undefined) {
      add(at, noObjectMessage(arena, id));
      continue;
    }
    if (colors.length !== variants.count) add(at, `needs one colour per variant (${variants.count}), not ${colors.length}`);
    if (colors.length > 0 && colorSchema.safeParse(colors[0]).success && !sameColor(colors[0], object.color)) {
      add([...at, 0], `variant 0 is the arena as authored, so this must be the colour the arena gives "${id}" (${object.color ?? 'it gives none'})`);
    }
  }
}

/** What `avoid-contact` and `endOnContact` can name: the kind of a collider (build-arena.ts adds it to its tags) and the tags the arena gives. */
function colliderTags(arena: ScenarioShape['arena']): Set<string> {
  const tags = new Set<string>();
  if (arena.walls.length > 0) tags.add('wall');
  if (arena.boxes.length > 0) tags.add('box');
  if (arena.cylinders.length > 0) tags.add('cylinder');
  if (arena.objects.length > 0) tags.add('object');
  for (const collider of [...arena.walls, ...arena.boxes, ...arena.cylinders, ...arena.objects]) {
    for (const tag of collider.tags) tags.add(tag);
  }
  return tags;
}

/** Each tag of `endOnContact` is one that something in the arena has, and is listed once. */
function endOnContactIssues(scenario: ScenarioShape, add: Add): void {
  if (scenario.endOnContact === undefined) return;
  const tags = colliderTags(scenario.arena);
  const first = new Map<string, number>();
  scenario.endOnContact.forEach((tag, i) => {
    if (tag === '') return; // the shape says it is empty
    const earlier = first.get(tag);
    if (earlier !== undefined) {
      add(['endOnContact', i], `"${tag}" is already listed at endOnContact[${earlier}]`);
      return;
    }
    first.set(tag, i);
    if (!tags.has(tag)) add(['endOnContact', i], `nothing in the arena has the tag "${tag}" (tags: ${list([...tags], 'none')})`);
  });
}

function goalIssues(scenario: ScenarioShape, add: Add): void {
  const { arena } = scenario;
  const zoneIds = arena.paint.zones.map((zone) => zone.id);
  const objectIds = arena.objects.map((object) => object.id);
  const tags = colliderTags(arena);
  const servoRoles = rolesOfKind('servo');

  const zoneAt = (path: (string | number)[], zone: string) => {
    if (!zoneIds.includes(zone)) add(path, `no zone "${zone}" in the arena (${zoneIds.length > 0 ? `zones: ${zoneIds.join(', ')}` : 'the arena has no zones'})`);
  };
  const objectAt = (path: (string | number)[], object: string): boolean => {
    if (objectIds.includes(object)) return true;
    add(path, noObjectMessage(arena, object));
    return false;
  };
  const withinTimeLimit = (path: (string | number)[], seconds: number) => {
    if (seconds > scenario.timeLimitS) add(path, `must not be more than the time limit (${scenario.timeLimitS} s)`);
  };

  const firstOfId = new Map<string, number>();
  scenario.goals.forEach((goal, i) => {
    const at = (field: string) => ['goals', i, field];
    const earlier = firstOfId.get(goal.id);
    if (earlier === undefined) firstOfId.set(goal.id, i);
    else add(at('id'), `the id "${goal.id}" is already used by goals[${earlier}]`);

    switch (goal.kind) {
      case 'reach-zone':
        zoneAt(at('zone'), goal.zone);
        break;
      case 'checkpoints-in-order':
        goal.zones.forEach((zone, j) => zoneAt(['goals', i, 'zones', j], zone));
        checkpointOverlapIssues(arena, goal.zones, i, add);
        break;
      case 'stay-on-line':
        if (arena.paint.lines.length === 0) add(at('kind'), 'stay-on-line needs a line painted in the arena');
        break;
      case 'avoid-contact':
        if (!tags.has(goal.tag)) {
          add(at('tag'), `nothing in the arena has the tag "${goal.tag}" (tags: ${list([...tags], 'none')})`);
        }
        break;
      case 'object-in-zone':
        if (!objectIds.includes(goal.object)) {
          add(at('object'), `no object "${goal.object}" in the arena (${objectIds.length > 0 ? `objects: ${objectIds.join(', ')}` : 'the arena has no objects'})`);
        }
        zoneAt(at('zone'), goal.zone);
        break;
      case 'stop-in-zone':
        zoneAt(at('zone'), goal.zone);
        withinTimeLimit(at('holdS'), goal.holdS);
        break;
      case 'servo-angle':
        if (!servoRoles.includes(goal.role as RobotRole)) add(at('role'), `"${goal.role}" is not a servo role (${servoRoles.join(', ')})`);
        if (goal.maxDeg < goal.minDeg) add(at('maxDeg'), `must be at least minDeg (${goal.minDeg})`);
        if (goal.whenInZone !== undefined) zoneAt(at('whenInZone'), goal.whenInZone);
        break;
      case 'finish-within':
        withinTimeLimit(at('seconds'), goal.seconds);
        break;
      case 'uses-block':
        if (!blockTypeSchema.safeParse(goal.blockType).success) {
          add(at('blockType'), 'a block type is letters, digits and "_"');
        } else if (scenario.toolbox && !scenario.toolbox.includes(goal.blockType)) {
          add(at('blockType'), `the toolbox does not list "${goal.blockType}"`);
        }
        break;
      case 'object-held':
        objectAt(at('object'), goal.object);
        withinTimeLimit(at('holdS'), goal.holdS);
        break;
      case 'object-placed':
        if (objectAt(at('object'), goal.object)) placedZoneIssues(scenario, goal, i, add);
        else if (goal.zone !== undefined) zoneAt(at('zone'), goal.zone);
        withinTimeLimit(at('restS'), goal.restS);
        break;
      case 'object-on-object':
        objectAt(at('top'), goal.top);
        objectAt(at('bottom'), goal.bottom);
        if (goal.top === goal.bottom) add(at('bottom'), `must be another object than top ("${goal.top}")`);
        withinTimeLimit(at('restS'), goal.restS);
        break;
      case 'object-unmoved':
        objectAt(at('object'), goal.object);
        break;
    }
  });
}

/**
 * N19 D2: `object-placed` goes to one zone, or to the zone of the object's colour, never both; every colour the object has in a variant (the
 * arena's, or its list in `variants.objectColors`) has a zone of the arena, and each colour is listed once whatever the case of its digits.
 */
function placedZoneIssues(scenario: ScenarioShape, goal: Extract<ScenarioShape['goals'][number], { kind: 'object-placed' }>, index: number, add: Add): void {
  const at = (...path: (string | number)[]) => ['goals', index, ...path];
  const zoneIds = scenario.arena.paint.zones.map((zone) => zone.id);
  const noZone = (zone: string) => `no zone "${zone}" in the arena (${zoneIds.length > 0 ? `zones: ${zoneIds.join(', ')}` : 'the arena has no zones'})`;
  if ((goal.zone === undefined) === (goal.zoneByColor === undefined)) {
    add(at(), 'needs a zone or a zoneByColor, one of the two');
    return;
  }
  if (goal.zone !== undefined) {
    if (!zoneIds.includes(goal.zone)) add(at('zone'), noZone(goal.zone));
    return;
  }
  const byColor = Object.entries(goal.zoneByColor ?? {});
  const seen = new Map<string, string>();
  for (const [color, zone] of byColor) {
    if (!colorSchema.safeParse(color).success) {
      add(at('zoneByColor', color), 'a colour is "#rrggbb"');
      continue;
    }
    if (!zoneIds.includes(zone)) add(at('zoneByColor', color), noZone(zone));
    const earlier = seen.get(colorKey(color));
    if (earlier !== undefined) add(at('zoneByColor', color), `the colour ${color} is listed already (${earlier})`);
    else seen.set(colorKey(color), color);
  }
  const object = scenario.arena.objects.find((candidate) => candidate.id === goal.object)!;
  const listed = scenario.variants.objectColors;
  const colors = listed !== undefined && Object.hasOwn(listed, goal.object) ? listed[goal.object]! : object.color === undefined ? [] : [object.color];
  if (colors.length === 0) {
    add(at('zoneByColor'), `needs an object with a colour ("${goal.object}" has none)`);
    return;
  }
  const told = new Set<string>();
  colors.forEach((color, variant) => {
    // A colour that is not one is told where it is written (variants.objectColors); the rules still run after a format issue.
    if (!colorSchema.safeParse(color).success || seen.has(colorKey(color)) || told.has(colorKey(color))) return;
    told.add(colorKey(color));
    add(at('zoneByColor'), `no zone for ${color}, the colour of "${goal.object}" in variant ${variant} (colours: ${[...seen.values()].join(', ') || 'none'})`);
  });
}

/**
 * The zones of one route may not overlap each other: a robot in the overlap would enter two checkpoints at once, and which of them comes
 * first would be a matter of how the list is written. Zones that only touch (a shared edge or corner) are fine. A zone listed twice is the
 * same zone, not an overlap, and a pair is told once however often its zones are listed. The issue is at the later zone of the pair.
 */
function checkpointOverlapIssues(arena: ScenarioShape['arena'], zones: readonly string[], goalIndex: number, add: Add): void {
  const polygonOf = (id: string) => arena.paint.zones.find((zone) => zone.id === id)?.polygonCm;
  const told = new Set<string>();
  zones.forEach((id, j) => {
    const polygon = polygonOf(id);
    if (polygon === undefined) return;
    for (let k = 0; k < j; k++) {
      const earlier = zones[k]!;
      const earlierPolygon = polygonOf(earlier);
      const pair = [earlier, id].sort().join('\n');
      if (earlier === id || earlierPolygon === undefined || told.has(pair)) continue;
      if (polygonsOverlap(earlierPolygon, polygon)) {
        told.add(pair);
        add(['goals', goalIndex, 'zones', j], `zone "${id}" overlaps zone "${earlier}" (zones[${k}]): the zones of one route may not overlap, or it is not clear which is entered first`);
      }
    }
  });
}

function scoreIssues(scenario: ScenarioShape, add: Add): void {
  const bonus = scenario.scoring.timeBonusMax;
  if (scenario.key === robotSandboxKey) {
    if (scenario.goals.length > 0) add(['goals'], `${robotSandboxKey} has no goals`);
    if (bonus !== undefined) add(['scoring', 'timeBonusMax'], `${robotSandboxKey} has no score`);
    return;
  }
  if (scenario.goals.length === 0) {
    add(['goals'], `a scored scenario needs at least one goal (only ${robotSandboxKey} has none)`);
    return;
  }
  const goalPoints = scenario.goals.reduce((sum, goal) => sum + goal.points, 0);
  const total = goalPoints + (bonus ?? 0);
  if (total !== SCENARIO_MAX_SCORE) {
    add(['goals'], `the points add up to ${total} (goals ${goalPoints} + time bonus ${bonus ?? 0}), not ${SCENARIO_MAX_SCORE}`);
  }
}

/** `goals[2].zones[1]` */
export function formatScenarioPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`), '');
}

export type ScenarioIssue = { path: string; message: string };

/** A scenario that does not validate: every issue, each with the path of the value at fault. */
export class ScenarioError extends Error {
  readonly issues: readonly ScenarioIssue[];

  constructor(key: string | undefined, issues: readonly ScenarioIssue[]) {
    super(`Invalid scenario${key === undefined ? '' : ` "${key}"`}: ${issues.map((issue) => `${issue.path === '' ? 'scenario' : issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'ScenarioError';
    this.issues = issues;
  }
}

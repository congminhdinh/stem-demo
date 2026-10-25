// The result of a robot check as the lab reports it to the host (N18 R7.1, robot plan §4.6 and §4.7). R6.2 (the scorer) produces a
// `RobotCheckResult`; the host bridge (src/ui/app/host-bridge.ts) turns it into a `check-result` message. This module is the contract
// between the two: the shape, and the bounds the host's parser holds every field to (docs/lab-embed-contract.md §2, the shared fixture
// docs/fixtures/stem-lab-v1-robot.json). The host drops a whole message with one field out of its bounds and stores nothing for a
// result that lacks a field it needs, so a result outside them is a bug of the lab: `robotCheckResultProblems` finds it before it is sent.
//
// A leaf, like robot-keys.ts: it imports nothing, so the host bridge in the main bundle reads it without pulling the scenario schema in.
// Its numbers are pinned to the scenario schema's by check-result.test.ts.

/** The simulator and its version, which a check names so a result can be replayed with the engine that made it (plan §3, determinism). */
export const ROBOT_ENGINE = 'robot-engine@1';

/** What the host accepts of the robot fields (the fixture's `bounds`, the host's `ROBOT_LIMITS`). */
export const ROBOT_CHECK_LIMITS = {
  /** Every scored robot scenario scores 0..100 (the scenario schema's `SCENARIO_MAX_SCORE`). */
  maxScore: 100,
  /** The most variants a check reports (the schema's `VARIANTS_MAX`). */
  maxVariants: 10,
  simTimeMsMax: 3_600_000,
  scenarioVersionMin: 1,
  scenarioVersionMax: 2_147_483_647,
  engine: /^[A-Za-z0-9._@-]{1,50}$/,
  programHash: /^[0-9a-fA-F]{1,64}$/,
  /** stem-lab/v1 for every lab: at most 50 goals, an id and a label of 1 to 200 characters. */
  maxGoals: 50,
  maxGoalText: 200,
} as const;

/** One seeded run of a check (plan §4.6 variants): its own verdict, score (0..100) and simulated time. */
export type RobotVariantResult = {
  seed: number;
  /** Every goal passed in this variant. */
  passed: boolean;
  score: number;
  simTimeMs: number;
};

/** A goal as the host reads it: `{ id, label, passed }`, the stem-lab/v1 shape. `label` is in the lab's language. */
export type RobotGoalResult = {
  id: string;
  label: string;
  /** The goal passed in EVERY variant. */
  passed: boolean;
};

/**
 * The result of a check of a scenario with goals (a scored one; the goal-less sandbox sends a plain `{ passed, goals: [] }`).
 * Every field is required: the host stores nothing for a result without the score, scenario version and engine, and the project that
 * goes with a check is tied to it by `programHash`. `goals` lists the goals of the scenario's `ready` exactly, in its order (the bridge
 * checks that: it knows what it announced).
 */
export type RobotCheckResult = {
  /** Every goal passed in every variant. */
  passed: boolean;
  goals: readonly RobotGoalResult[];
  /** The mean of the variants' scores, 0..maxScore. */
  score: number;
  maxScore: typeof ROBOT_CHECK_LIMITS.maxScore;
  /** The simulated time of the check, in milliseconds. */
  simTimeMs: number;
  /** At most `ROBOT_CHECK_LIMITS.maxVariants`; each with these four fields (the host reads no others). */
  variants: readonly RobotVariantResult[];
  engine: typeof ROBOT_ENGINE;
  /** The scenario's version (`Scenario.version`), which must be the one `ready` announced. */
  scenarioVersion: number;
  /** Hex, at most 64 digits: the hash of the program's IR (not of its Blockly JSON, which has block positions and ids). */
  programHash: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isTrueOrFalse = (value: unknown): value is boolean => typeof value === 'boolean';
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= ROBOT_CHECK_LIMITS.maxGoalText;

const SCORE_PROBLEM = `must be a finite number from 0 to ${ROBOT_CHECK_LIMITS.maxScore}`;
const SIM_TIME_PROBLEM = `must be a finite number from 0 to ${ROBOT_CHECK_LIMITS.simTimeMsMax}`;
const SCENARIO_VERSION_PROBLEM = `must be a whole number from ${ROBOT_CHECK_LIMITS.scenarioVersionMin} to ${ROBOT_CHECK_LIMITS.scenarioVersionMax}`;

const isScore = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && value <= ROBOT_CHECK_LIMITS.maxScore;
const isSimTime = (value: unknown): value is number => isFiniteNumber(value) && value >= 0 && value <= ROBOT_CHECK_LIMITS.simTimeMsMax;
const isScenarioVersion = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= ROBOT_CHECK_LIMITS.scenarioVersionMin &&
  value <= ROBOT_CHECK_LIMITS.scenarioVersionMax;

function goalProblems(goals: unknown, problems: string[]): goals is readonly Record<string, unknown>[] {
  if (!Array.isArray(goals)) {
    problems.push('goals: must be a list');
    return false;
  }
  if (goals.length === 0) {
    problems.push('goals: at least one (a result with a score lists the goals it scores; the goal-less sandbox has no score)');
  } else if (goals.length > ROBOT_CHECK_LIMITS.maxGoals) {
    problems.push(`goals: at most ${ROBOT_CHECK_LIMITS.maxGoals}`);
  }
  let wellFormed = true;
  goals.forEach((goal: unknown, index) => {
    if (!isRecord(goal)) {
      problems.push(`goals[${index}]: must be an object`);
      wellFormed = false;
      return;
    }
    if (!isText(goal.id)) {
      problems.push(`goals[${index}].id: must be 1 to ${ROBOT_CHECK_LIMITS.maxGoalText} characters`);
    }
    if (!isText(goal.label)) {
      problems.push(`goals[${index}].label: must be 1 to ${ROBOT_CHECK_LIMITS.maxGoalText} characters`);
    }
    if (!isTrueOrFalse(goal.passed)) {
      problems.push(`goals[${index}].passed: must be true or false`);
      wellFormed = false;
    }
  });
  return wellFormed;
}

function variantProblems(variants: unknown, problems: string[]): variants is readonly Record<string, unknown>[] {
  if (!Array.isArray(variants)) {
    problems.push('variants: must be a list');
    return false;
  }
  if (variants.length > ROBOT_CHECK_LIMITS.maxVariants) {
    problems.push(`variants: at most ${ROBOT_CHECK_LIMITS.maxVariants}`);
  }
  let wellFormed = true;
  variants.forEach((variant: unknown, index) => {
    if (!isRecord(variant)) {
      problems.push(`variants[${index}]: must be an object`);
      wellFormed = false;
      return;
    }
    if (!Number.isSafeInteger(variant.seed)) {
      problems.push(`variants[${index}].seed: must be a safe integer`);
    }
    if (!isTrueOrFalse(variant.passed)) {
      problems.push(`variants[${index}].passed: must be true or false`);
      wellFormed = false;
    }
    if (!isScore(variant.score)) {
      problems.push(`variants[${index}].score: ${SCORE_PROBLEM}`);
    }
    if (!isSimTime(variant.simTimeMs)) {
      problems.push(`variants[${index}].simTimeMs: ${SIM_TIME_PROBLEM}`);
    }
  });
  return wellFormed;
}

/**
 * What is wrong with a result that the host would drop or not store, each as `path: what is wrong`, in the order of the message; an empty
 * list for a result that is fine. Besides the bounds of every field, it holds `passed` to its meaning (plan §4.6): true exactly when every
 * goal passed, and so when every variant passed (a variant passes when all its goals do). The input is typed loosely on purpose: a JS
 * caller, or a test, can hand it anything.
 */
export function robotCheckResultProblems(result: RobotCheckResult): string[] {
  const problems: string[] = [];
  const fields: Record<string, unknown> = isRecord(result) ? result : {};
  const { passed, goals, score, maxScore, simTimeMs, variants, engine, scenarioVersion, programHash } = fields;

  if (!isTrueOrFalse(passed)) {
    problems.push('passed: must be true or false');
  }
  const goalsWellFormed = goalProblems(goals, problems);
  if (isTrueOrFalse(passed) && goalsWellFormed && goals.length > 0) {
    const failed = goals.find((goal) => goal.passed === false);
    if (passed && failed !== undefined) {
      problems.push(`passed: is true but goal "${String(failed.id)}" did not pass`);
    } else if (!passed && failed === undefined) {
      problems.push('passed: is false but every goal passed');
    }
  }

  if (!isScore(score)) {
    problems.push(`score: ${SCORE_PROBLEM}`);
  }
  if (maxScore !== ROBOT_CHECK_LIMITS.maxScore) {
    problems.push(`maxScore: must be ${ROBOT_CHECK_LIMITS.maxScore}`);
  }
  if (!isSimTime(simTimeMs)) {
    problems.push(`simTimeMs: ${SIM_TIME_PROBLEM}`);
  }

  const variantsWellFormed = variantProblems(variants, problems);
  if (isTrueOrFalse(passed) && variantsWellFormed && variants.length > 0) {
    const failedIndex = variants.findIndex((variant) => variant.passed === false);
    if (passed && failedIndex >= 0) {
      problems.push(`passed: is true but variant ${failedIndex} (seed ${String(variants[failedIndex]?.seed)}) did not pass`);
    } else if (!passed && failedIndex < 0) {
      problems.push('passed: is false but every variant passed');
    }
  }

  if (typeof engine !== 'string' || !ROBOT_CHECK_LIMITS.engine.test(engine)) {
    problems.push('engine: must be 1 to 50 characters of A-Z a-z 0-9 . _ @ -');
  }
  if (!isScenarioVersion(scenarioVersion)) {
    problems.push(`scenarioVersion: ${SCENARIO_VERSION_PROBLEM}`);
  }
  if (typeof programHash !== 'string' || !ROBOT_CHECK_LIMITS.programHash.test(programHash)) {
    problems.push('programHash: must be 1 to 64 hexadecimal digits');
  }
  return problems;
}

/**
 * What is wrong with the robot fields of `ready` (each optional, left out when the lab has none, never null), as `robotCheckResultProblems`
 * says it: the scenario's version, and the top score, which is always 100.
 */
export function robotReadyProblems(fields: { scenarioVersion?: unknown; maxScore?: unknown }): string[] {
  const problems: string[] = [];
  if (fields.scenarioVersion !== undefined && !isScenarioVersion(fields.scenarioVersion)) {
    problems.push(`scenarioVersion: ${SCENARIO_VERSION_PROBLEM}`);
  }
  if (fields.maxScore !== undefined && fields.maxScore !== ROBOT_CHECK_LIMITS.maxScore) {
    problems.push(`maxScore: must be ${ROBOT_CHECK_LIMITS.maxScore} (leave it out for a scenario without goals)`);
  }
  return problems;
}

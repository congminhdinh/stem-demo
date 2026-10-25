import { robotSandboxKey } from '../../samples/robot-keys';
import { ScenarioError, formatScenarioPath, scenarioSchema, type Scenario, type ScenarioInput } from './scenario-schema';

export * from './scenario-schema';

// The scenario of a robot lab, loaded (N18 R5.1, robot plan §4.6). `scenario-schema.ts` is what a scenario is and how it is
// refused; this is how the rest of the app gets one and asks the questions that do not need a world: its top score and which
// scripted inputs are due. `variants.ts` turns it into the starts a check runs.

/**
 * Validates authored scenario JSON, fills its defaults and sorts its inputs by time. Throws a `ScenarioError` that names each bad
 * path (`goals[1].zones[0]: no zone "x" in the arena (…)`). The input is not changed. A scenario that loads is one a world can be
 * built from: what its goals name exists in its arena.
 */
export function loadScenario(json: unknown): Scenario {
  const result = scenarioSchema.safeParse(json);
  if (!result.success) {
    const key = (json as { key?: unknown } | null)?.key;
    throw new ScenarioError(
      typeof key === 'string' ? key : undefined,
      result.error.issues.map((issue) => ({ path: formatScenarioPath(issue.path), message: issue.message })),
    );
  }
  return result.data;
}

/**
 * The top score: the points of the goals plus the most the time bonus adds, which the schema holds to `SCENARIO_MAX_SCORE` (100);
 * undefined for the sandbox, which has no goals and no score. A score is clamped to `0..maxScore`.
 */
export function scenarioMaxScore(scenario: Pick<Scenario, 'key' | 'goals' | 'scoring'>): number | undefined {
  if (scenario.key === robotSandboxKey) return undefined;
  return scenario.goals.reduce((sum, goal) => sum + goal.points, scenario.scoring.timeBonusMax ?? 0);
}

/**
 * The scripted inputs due in a window of run time: those with `t0S ≤ atS < t1S`, in time order. Windows that follow one another
 * (`[0, dt)`, `[dt, 2dt)`, …) hand out every input exactly once, so a real-time frame, a 4× frame, a headless batch and a single
 * tick all apply the script at the same instants. The caller computes its window ends from the tick number (`k · dt`), not by
 * adding up floats. `t1S < t0S` or a non-finite end is a bug of the caller and throws.
 */
export function inputsDueBetween(scenario: Pick<Scenario, 'inputs'>, t0S: number, t1S: number): readonly ScenarioInput[] {
  if (!Number.isFinite(t0S) || !Number.isFinite(t1S) || t1S < t0S) {
    throw new RangeError(`An input window is t0 ≤ t1 in seconds, not ${t0S} .. ${t1S}.`);
  }
  const due: ScenarioInput[] = [];
  for (const input of scenario.inputs) {
    if (input.atS >= t1S) break;
    if (input.atS >= t0S) due.push(input);
  }
  return due;
}

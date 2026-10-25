import { scenarioMaxScore, type Scenario } from '../../core/scenario/scenario';
import type { RobotLabProfile } from '../robot-keys';
import type { ScenarioCatalog } from './index';

// The manifest of the robot scenarios this build ships (N18 R7.1): `robot-scenarios.v1.json`, written by scripts/export-robot-manifest.mjs
// and committed as docs/fixtures/robot-scenarios.v1.json. The repositories that name a scenario by key (STEMLearning's LabTemplateCatalog,
// its appsettings `Robot` list, the admin app's template picker) copy it and pin themselves to it with a test, so a key, a profile or a
// goal id that drifts from the lab fails there and not in a learner's lesson (docs/lab-embed-contract.md §1). It says only what those
// repositories need and nothing of the arena or the scoring. Plain data, no engine: it is read from the catalog and nothing else.

export const MANIFEST_SCHEMA = 'robot-scenarios/v1';

export type RobotManifestEntry = {
  /** The scenario's key (`rb-*`), never renamed or reused. */
  key: Scenario['key'];
  /** Raised when the scenario changes its behaviour; the same number `ready` and `check-result` carry as `scenarioVersion`. */
  version: number;
  title: { vi: string; en: string };
  /** The ids of the goals, in the order `ready` lists them. */
  goalIds: string[];
  /** The top score (100). Left out for the sandbox, which has no goals and no score, never null. */
  maxScore?: number;
  /** The lowest board profile the scenario opens with. */
  profile: RobotLabProfile;
  hasGoals: boolean;
};

export type RobotManifest = { schema: typeof MANIFEST_SCHEMA; scenarios: RobotManifestEntry[] };

/** The manifest of a catalog, its scenarios in the order of the lessons (`robotTemplateKeys`). */
export function robotScenarioManifest(catalog: Pick<ScenarioCatalog, 'scenarios'>): RobotManifest {
  return {
    schema: MANIFEST_SCHEMA,
    scenarios: catalog.scenarios.map((scenario) => {
      const maxScore = scenarioMaxScore(scenario);
      return {
        key: scenario.key,
        version: scenario.version,
        title: { vi: scenario.title.vi, en: scenario.title.en },
        goalIds: scenario.goals.map((goal) => goal.id),
        ...(maxScore === undefined ? {} : { maxScore }),
        profile: scenario.profile,
        hasGoals: scenario.goals.length > 0,
      };
    }),
  };
}

/** The same value with the keys of every object in order, so that the same manifest is always the same bytes. Lists keep their order. */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withSortedKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, withSortedKeys(record[key])]));
  }
  return value;
}

/** The file's text: keys sorted at every depth, two-space indent, one newline at the end. */
export function serializeManifest(manifest: RobotManifest): string {
  return `${JSON.stringify(withSortedKeys(manifest), null, 2)}\n`;
}

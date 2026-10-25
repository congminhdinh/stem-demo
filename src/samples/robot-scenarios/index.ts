import { loadScenario, type Scenario } from '../../core/scenario/scenario';
import { robotTemplateKeys } from '../robot-keys';

// The robot scenarios this build ships (N18 R5.1, robot plan §4.6): the registry of `rb-*.json` in this folder. A scenario is added by
// putting its file here, named after its key (`rb-line-follow.json`); nothing else lists it. R5.2 writes the six pilot scenarios and
// `rb-sandbox`; until then the folder is empty and so is the catalog.
//
// Every file is loaded and validated when this module is first imported, so broken data fails there (like the kit catalog), not when a
// learner opens the lab. The files are bundled with whatever imports this module: the robot lab’s own chunk, never the generic editor.
// `import.meta.glob` is Vite’s (and Vitest’s): a Node script builds a catalog from files it reads with `createScenarioCatalog`.

export type ScenarioCatalog = {
  /** Every scenario, in the order of the lessons (`robotTemplateKeys`). */
  readonly scenarios: readonly Scenario[];
  /** The scenario of a key, or undefined when this build has none. */
  get(key: string): Scenario | undefined;
};

/** Builds a catalog from scenario files by path (`./rb-drive-to-zone.json`) to their JSON. Throws on a file that does not validate. */
export function createScenarioCatalog(files: Readonly<Record<string, unknown>>): ScenarioCatalog {
  const byKey = new Map<string, Scenario>();
  for (const [path, json] of Object.entries(files)) {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const scenario = loadScenario(json);
    if (file !== `${scenario.key}.json`) {
      throw new Error(`robot-scenarios/${file} holds the scenario "${scenario.key}": a scenario file is named after its key.`);
    }
    byKey.set(scenario.key, scenario);
  }
  const scenarios = robotTemplateKeys.flatMap((key) => byKey.get(key) ?? []);
  return { scenarios, get: (key) => byKey.get(key) };
}

export const scenarioCatalog: ScenarioCatalog = createScenarioCatalog(import.meta.glob('./rb-*.json', { eager: true, import: 'default' }));

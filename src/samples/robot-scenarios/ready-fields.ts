import { robotSandboxKey } from '../robot-keys';
import driveToZone from './rb-drive-to-zone.json' with { type: 'json' };
import lineFollow from './rb-line-follow.json' with { type: 'json' };
import miniMission from './rb-mini-mission.json' with { type: 'json' };
import sandbox from './rb-sandbox.json' with { type: 'json' };
import servoGate from './rb-servo-gate.json' with { type: 'json' };
import squareRoute from './rb-square-route.json' with { type: 'json' };
import stopAtWall from './rb-stop-at-wall.json' with { type: 'json' };

// What a robot lab tells the host of its scenario in `ready` (N18 R5.2, plan §4.7): the scenario's version and, for a scored one, its top
// score. Read from the scenario files of this folder, the ones the catalog (index.ts) validates, so the numbers are never written twice.
//
// Not through the catalog, for two reasons. robot-templates.ts, which hands these fields to the host bridge, is in the main bundle of every
// lab, and the catalog's scenario schema pulls in the arena's (src/core/world), which only the robot lab may load (e2e/robot-bundle.spec.ts).
// And Playwright imports robot-templates.ts into plain Node (e2e/robot-lab.spec.ts), where `import.meta.glob` (the catalog's) does not exist
// and a JSON module needs the `type: 'json'` attribute and has a default export only. So this leaf imports each file that way, by name (the
// seven keys never change), and reads three fields of it as the catalog does (`scenarioMaxScore`: the goals' points plus the time bonus,
// none for the sandbox); ready-fields.test.ts holds the two to the same numbers for every key. The files' JSON (about 13 kB minified)
// rides in the main bundle; the schema and the world do not.

export type ScenarioReadyFields = { scenarioVersion: number; maxScore?: number };

/** The fields read from each scenario file, by the file's path (`./rb-line-follow.json`). */
export type ScenarioFileFields = {
  version: Readonly<Record<string, number>>;
  goals: Readonly<Record<string, readonly { readonly points: number }[]>>;
  scoring: Readonly<Record<string, { readonly timeBonusMax?: number }>>;
};

/** The ready fields of each file, by its key: a scenario file is named after its key (index.ts refuses one that is not). */
export function readyFieldsOf(files: ScenarioFileFields): ReadonlyMap<string, ScenarioReadyFields> {
  const table = new Map<string, ScenarioReadyFields>();
  for (const [path, version] of Object.entries(files.version)) {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const key = file.replace(/\.json$/, '');
    const goals = files.goals[path];
    const scoring = files.scoring[path];
    if (goals === undefined || scoring === undefined) {
      throw new Error(`robot-scenarios/${file}: no ${goals === undefined ? 'goals' : 'scoring'}`);
    }
    const maxScore = goals.reduce((sum, goal) => sum + goal.points, scoring.timeBonusMax ?? 0);
    table.set(key, key === robotSandboxKey ? { scenarioVersion: version } : { scenarioVersion: version, maxScore });
  }
  return table;
}

const table = readyFieldsOf({
  version: {
    './rb-drive-to-zone.json': driveToZone.version,
    './rb-square-route.json': squareRoute.version,
    './rb-stop-at-wall.json': stopAtWall.version,
    './rb-line-follow.json': lineFollow.version,
    './rb-servo-gate.json': servoGate.version,
    './rb-mini-mission.json': miniMission.version,
    './rb-sandbox.json': sandbox.version,
  },
  goals: {
    './rb-drive-to-zone.json': driveToZone.goals,
    './rb-square-route.json': squareRoute.goals,
    './rb-stop-at-wall.json': stopAtWall.goals,
    './rb-line-follow.json': lineFollow.goals,
    './rb-servo-gate.json': servoGate.goals,
    './rb-mini-mission.json': miniMission.goals,
    './rb-sandbox.json': sandbox.goals,
  },
  scoring: {
    './rb-drive-to-zone.json': driveToZone.scoring,
    './rb-square-route.json': squareRoute.scoring,
    './rb-stop-at-wall.json': stopAtWall.scoring,
    './rb-line-follow.json': lineFollow.scoring,
    './rb-servo-gate.json': servoGate.scoring,
    './rb-mini-mission.json': miniMission.scoring,
    './rb-sandbox.json': sandbox.scoring,
  },
});

/** The ready fields of a scenario of this build, or undefined for a key it has no file for. */
export const scenarioReadyFields = (key: string): ScenarioReadyFields | undefined => table.get(key);

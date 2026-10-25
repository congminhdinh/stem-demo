import { projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import {
  robotKitId,
  robotKitVersion,
  robotLabProfiles,
  robotSandboxKey,
  robotTemplates,
  type RobotLabProfile,
  type RobotTemplateKey,
} from './robot-keys';

// The table of keys, profiles and kits lives in robot-keys.ts, a module with no imports, so that the scenario schema (src/core/scenario)
// and the scenario catalog can read it without importing this file (which will read the catalog, N18 R5.2: that would be a cycle).
// It is re-exported here, so that everything that reads the table through this module keeps doing so.
export {
  isRobotLabProfile,
  isRobotTemplateKey,
  robotKitId,
  robotKitVersion,
  robotLabProfiles,
  robotSandboxKey,
  robotTemplateKeys,
  robotTemplates,
  type RobotLabProfile,
  type RobotTemplate,
  type RobotTemplateKey,
  type RobotTitleKey,
} from './robot-keys';

// The robot labs an embedding page can launch by key (N18 R4.1, `lab=robot`). Like the generic and Yolo:Bit keys they are a public
// contract: course content stores them (LabTemplateCatalog, STEMLearning), so a key is never renamed or reused. A key names a
// SCENARIO (the arena, the goals and the score come with R3.x and R6); what this module owns is the project it opens with
// (plan §4.0) and the profile it needs.

/**
 * Why `profile` cannot open `key` (English, for the page that built the launch URL, in the words of the Yolo:Bit labs), or null when
 * it can: it has all the scenario needs. `needed` is that profile, the scenario's own by default; a test that wants to see a
 * scenario refuse a lower level gives another one, so that no test has to change the table.
 */
export function robotTemplateProfileProblem(key: RobotTemplateKey, profile: RobotLabProfile, needed: RobotLabProfile = robotTemplates[key].profile): string | null {
  return robotLabProfiles.indexOf(profile) >= robotLabProfiles.indexOf(needed)
    ? null
    : `The template "${key}" needs profile=${needed}: it uses blocks or parts that ${profile} does not have.`;
}

/** The scenario version and the top score of every robot scenario, until the scenario data of R3.5 brings its own. */
const scenarioVersion = 1;
const maxScore = 100;

/**
 * What a robot lab adds to `ready` (plan §4.7): the scenario's version and, for a scored scenario, its top score. The sandbox has no
 * goals, so it has no score and the field is left out, never null.
 */
export function robotReadyFields(key: RobotTemplateKey): { scenarioVersion: number; maxScore?: number } {
  return key === robotSandboxKey ? { scenarioVersion } : { scenarioVersion, maxScore };
}

/**
 * The project of a robot scenario (plan §4.0), new on every call: the UNO board alone (a robot's wiring is its kit's, not wires),
 * the profile, the kit, and an empty program until the robot blocks of R2.2 give the learner something to place. Schema version
 * stays 1. The empty program is `{}`, which is what Blockly itself saves for an empty workspace: written so, opening the lab changes
 * nothing in the project, and the host is sent no project-changed. `profile` is the launch's, refused (RangeError) when lower than
 * `needed`, the level the scenario needs (its own by default, as in `robotTemplateProfileProblem`); a project opens with `profile`, or
 * with `needed` when the launch gave none.
 */
export function robotStarterDocument(key: RobotTemplateKey, profile?: RobotLabProfile, needed: RobotLabProfile = robotTemplates[key].profile): ProjectDocument {
  if (profile !== undefined) {
    const problem = robotTemplateProfileProblem(key, profile, needed);
    if (problem !== null) {
      throw new RangeError(problem);
    }
  }
  return projectDocumentSchema.parse({
    schemaVersion: 1,
    id: `template-${key}`,
    name: 'Robot',
    profile: profile ?? needed,
    kit: { id: robotKitId, version: robotKitVersion },
    circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
    program: { blocks: {} },
  });
}

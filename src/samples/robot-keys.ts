// The keys of the robot labs, the profiles they launch with and the kit each uses (N18 R4.1, R5.1; N19 D-G1): the table every other part reads. A leaf: it
// imports nothing, so the scenario schema (src/core/scenario), the scenario catalog (src/samples/robot-scenarios) and robot-templates.ts can
// all read it without importing one another (robot-templates.ts is to read the catalog, N18 R5.2; the catalog and the schema read this).
// Like the generic and Yolo:Bit keys the robot keys are a public contract: course content stores them (LabTemplateCatalog, STEMLearning),
// so a key is never renamed or reused.

/** The one scenario with no goals and so no score. */
export const robotSandboxKey = 'rb-sandbox';

/**
 * The scenarios of the robot lab, in the order of the lessons; `rb-sandbox` has no goals and no score. N19 D5 (D-G12): the four gripper car
 * lessons (8-11) come after the six of the rover and before the sandbox, the order of the manifest and of the LMS's module 4.
 */
export const robotTemplateKeys = [
  'rb-drive-to-zone',
  'rb-square-route',
  'rb-stop-at-wall',
  'rb-line-follow',
  'rb-servo-gate',
  'rb-mini-mission',
  'rb-grip-pick',
  'rb-grip-deliver',
  'rb-grip-sort',
  'rb-grip-stack',
  robotSandboxKey,
] as const;

export type RobotTemplateKey = (typeof robotTemplateKeys)[number];

/** The board profiles a robot lab can be launched with (`profile=`), from the Basic board up: each one has all of the one before. */
export const robotLabProfiles = ['uno-basic', 'uno-advanced'] as const;

export type RobotLabProfile = (typeof robotLabProfiles)[number];

/**
 * The kits the robot labs run on, each with the version a lab launches it at (plan §4.0, §4.2; N19 D-G1): which modules the robot has and on
 * which ports lives in the kit's file (src/core/hardware/kits), the table here only says which kits there are. A kit is added by adding it
 * here, one line, and to `productionKits` (src/core/hardware/catalog.ts): never renamed, and a change of its data is a new version.
 */
export const robotKits = { 'ref-uno-rover': '0', 'ref-uno-gripper': '0' } as const;

export type RobotKitId = keyof typeof robotKits;

/** The version of `id` a robot lab launches it at. */
export function robotKitVersionOf(id: RobotKitId): string {
  return robotKits[id];
}

/** Exact, case-sensitive match against the table; no lookup that finds "constructor". */
export const isRobotKitId = (id: string): id is RobotKitId => Object.hasOwn(robotKits, id);

/**
 * The kit before there was a choice of two, and its version.
 * @deprecated Read the kit of the scenario: `robotTemplates[key].kit` (or `scenario.kit`) and `robotKitVersionOf`. Kept so that the
 * tests written for the single kit keep reading what they read.
 */
export const robotKitId = 'ref-uno-rover' satisfies RobotKitId;
/** @deprecated See `robotKitId`. */
export const robotKitVersion = robotKitVersionOf(robotKitId);

/** The message key of a scenario's title, which the UI says in its language (src/ui/i18n/messages.ts). */
export type RobotTitleKey = `robot.scenario.${RobotTemplateKey}`;

export type RobotTemplate = {
  /** The profile the scenario needs, which it opens with when the launch names none; a launch with a lower one is refused. */
  profile: RobotLabProfile;
  /** The kit the scenario runs on (N19 D-G1): its modules, ports and mechanics. The scenario file's own `kit` must be this one. */
  kit: RobotKitId;
  titleKey: RobotTitleKey;
};

/**
 * The kit of each scenario, key by key: a Record, so that a key added to the list above without a kit does not compile. Every scenario of
 * the pilot course and the sandbox run on the rover; N19 D5: the four gripper lessons on the gripper car.
 */
const templateKits: Readonly<Record<RobotTemplateKey, RobotKitId>> = {
  'rb-drive-to-zone': 'ref-uno-rover',
  'rb-square-route': 'ref-uno-rover',
  'rb-stop-at-wall': 'ref-uno-rover',
  'rb-line-follow': 'ref-uno-rover',
  'rb-servo-gate': 'ref-uno-rover',
  'rb-mini-mission': 'ref-uno-rover',
  'rb-grip-pick': 'ref-uno-gripper',
  'rb-grip-deliver': 'ref-uno-gripper',
  'rb-grip-sort': 'ref-uno-gripper',
  'rb-grip-stack': 'ref-uno-gripper',
  [robotSandboxKey]: 'ref-uno-rover',
};

/** Every scenario needs the Basic board today; the table, not the launch parser, is where a scenario that needs more says so. */
export const robotTemplates: Readonly<Record<RobotTemplateKey, Readonly<RobotTemplate>>> = Object.fromEntries(
  robotTemplateKeys.map((key) => [key, { profile: 'uno-basic', kit: templateKits[key], titleKey: `robot.scenario.${key}` }]),
) as Record<RobotTemplateKey, RobotTemplate>;

/** Exact, case-sensitive match against the list; no lookup on an object, so "constructor" is not a key. */
export const isRobotTemplateKey = (key: string): key is RobotTemplateKey => (robotTemplateKeys as readonly string[]).includes(key);

export const isRobotLabProfile = (value: string): value is RobotLabProfile => (robotLabProfiles as readonly string[]).includes(value);

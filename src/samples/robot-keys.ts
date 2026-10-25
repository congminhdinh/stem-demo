// The keys of the robot labs, the profiles they launch with and the kit they use (N18 R4.1, R5.1): the table every other part reads. A leaf: it
// imports nothing, so the scenario schema (src/core/scenario), the scenario catalog (src/samples/robot-scenarios) and robot-templates.ts can
// all read it without importing one another (robot-templates.ts is to read the catalog, N18 R5.2; the catalog and the schema read this).
// Like the generic and Yolo:Bit keys the robot keys are a public contract: course content stores them (LabTemplateCatalog, STEMLearning),
// so a key is never renamed or reused.

/** The one scenario with no goals and so no score. */
export const robotSandboxKey = 'rb-sandbox';

/** The scenarios of the robot lab, in the order of the lessons; `rb-sandbox` has no goals and no score. */
export const robotTemplateKeys = [
  'rb-drive-to-zone',
  'rb-square-route',
  'rb-stop-at-wall',
  'rb-line-follow',
  'rb-servo-gate',
  'rb-mini-mission',
  robotSandboxKey,
] as const;

export type RobotTemplateKey = (typeof robotTemplateKeys)[number];

/** The board profiles a robot lab can be launched with (`profile=`), from the Basic board up: each one has all of the one before. */
export const robotLabProfiles = ['uno-basic', 'uno-advanced'] as const;

export type RobotLabProfile = (typeof robotLabProfiles)[number];

/** The kit of every robot scenario for now (plan §4.0, §4.2): which modules the robot has and on which ports. */
export const robotKitId = 'ref-uno-rover';
export const robotKitVersion = '0';

/** The message key of a scenario's title, which the UI says in its language (src/ui/i18n/messages.ts). */
export type RobotTitleKey = `robot.scenario.${RobotTemplateKey}`;

export type RobotTemplate = {
  /** The profile the scenario needs, which it opens with when the launch names none; a launch with a lower one is refused. */
  profile: RobotLabProfile;
  kit: typeof robotKitId;
  titleKey: RobotTitleKey;
};

/** Every scenario needs the Basic board today; the table, not the launch parser, is where a scenario that needs more says so. */
export const robotTemplates: Readonly<Record<RobotTemplateKey, Readonly<RobotTemplate>>> = Object.fromEntries(
  robotTemplateKeys.map((key) => [key, { profile: 'uno-basic', kit: robotKitId, titleKey: `robot.scenario.${key}` }]),
) as Record<RobotTemplateKey, RobotTemplate>;

/** Exact, case-sensitive match against the list; no lookup on an object, so "constructor" is not a key. */
export const isRobotTemplateKey = (key: string): key is RobotTemplateKey => (robotTemplateKeys as readonly string[]).includes(key);

export const isRobotLabProfile = (value: string): value is RobotLabProfile => (robotLabProfiles as readonly string[]).includes(value);

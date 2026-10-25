import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { ROBOT_CHECK_LIMITS, type RobotCheckResult } from '../../core/scenario/check-result';
import { createHostBridge, LAB_PROTOCOL, RobotMessageError, ROBOT_LAB, type LabWindow, type RobotReady } from './host-bridge';

// docs/fixtures/stem-lab-v1-robot.json is the one fixture both repos test the robot fields of stem-lab/v1 with (N18 R7.1, plan §4.7). It is
// authored in STEMLearning (Web/packages/api/src/lab/__fixtures__/stem-lab-v1-robot.json, R7.4) and kept BYTE-IDENTICAL here: change both
// together, and only by adding. The host parses every "valid" message and drops every "invalid" one as a whole; here the bridge builds every
// "valid" message the lab can send, byte for byte, and refuses to build any of the others.

const FIXTURE_URL = new URL('../../../docs/fixtures/stem-lab-v1-robot.json', import.meta.url);
const FIXTURE_SHA256 = '8ee12774e5496c65dab53b5eec7f487697b438e4863e34e7822566fb5b7495d3';
const FIXTURE_BYTES = 47420;

type Message = Record<string, unknown>;
type Fixture = {
  protocol: string;
  fixtureVersion: number;
  bounds: Record<string, unknown>;
  valid: { name: string; message: Message }[];
  invalid: { name: string; reason: string; message: Message }[];
  nonFinite: { name: string; reason: string; base: string; path: (string | number)[]; value: string }[];
  incomplete: { name: string; reason: string; message: Message }[];
  notRobot: { name: string; note: string; message: Message }[];
};

const bytes = readFileSync(FIXTURE_URL);
const fixture = JSON.parse(bytes.toString('utf8')) as Fixture;

const hostOrigin = 'http://localhost:3000';
const validMessage = (name: string): Message => {
  const entry = fixture.valid.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`The fixture has no valid message "${name}".`);
  return entry.message;
};

/** A copy of the message with the field at `path` set to `value` (a number JSON cannot hold, for the nonFinite cases). */
function withField(message: Message, path: (string | number)[], value: unknown): Message {
  const copy = structuredClone(message);
  let target = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    target = target[key] as Record<string | number, unknown>;
  }
  target[path.at(-1)!] = value;
  return copy;
}

const READY_FIELDS = ['scenarioVersion', 'maxScore'];
const CHECK_FIELDS = ['score', 'maxScore', 'simTimeMs', 'variants', 'engine', 'scenarioVersion', 'programHash'];
const ROBOT_FIELDS = new Set(['lab', ...READY_FIELDS, ...CHECK_FIELDS]);
const CHECK_MESSAGE_KEYS = ['protocol', 'type', 'lab', 'passed', 'goals', ...CHECK_FIELDS];
const VARIANT_KEYS = ['seed', 'passed', 'score', 'simTimeMs'];

/** What the lab says of a message: the fields it sends, in its order. The host ignores the rest (the fixture has one message with some). */
function documentedPart(message: Message): Message {
  if (message.type !== 'check-result') return message;
  const kept = Object.fromEntries(CHECK_MESSAGE_KEYS.filter((key) => message[key] !== undefined).map((key) => [key, message[key]]));
  if (Array.isArray(kept.variants)) {
    kept.variants = (kept.variants as Message[]).map((variant) => Object.fromEntries(VARIANT_KEYS.filter((key) => variant[key] !== undefined).map((key) => [key, variant[key]])));
  }
  return kept;
}

function setup(lab?: typeof ROBOT_LAB) {
  const posted: Message[] = [];
  const host = { postMessage: (message: unknown) => void posted.push(message as Message) };
  const window = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as LabWindow;
  const bridge = createHostBridge({ host, hostOrigin, window, onLoadProject: () => {}, ...(lab === undefined ? {} : { lab }) });
  return { bridge, posted };
}

/** The two goals every scored check-result of the fixture lists, as `ready` announced them. */
const announcedGoals = (message: Message) =>
  (message.goals as unknown[]).length === 0
    ? []
    : [
        { id: 'stop-in-zone', label: 'Dừng trong vùng đích' },
        { id: 'avoid-wall', label: 'Không chạm tường' },
      ];

const hasRobotFields = (message: Message) => CHECK_FIELDS.some((field) => field in message);

/** Hands a robot field to the scorer's type as it came, whatever it is: the builder's job is to refuse what is not a `RobotCheckResult`. */
const checkInputOf = (message: Message): RobotCheckResult =>
  Object.fromEntries(['passed', 'goals', ...CHECK_FIELDS].filter((field) => field in message).map((field) => [field, message[field]])) as unknown as RobotCheckResult;

/**
 * What the bridge posts when the lab is made to send `message`, or the error it refused with. A check-result comes after a `ready` (of the
 * robot lab, which announces the goals it lists); its own messages are the ones returned.
 */
function send(message: Message, lab?: typeof ROBOT_LAB): { posted: Message[]; error: unknown } {
  const { bridge, posted } = setup(lab);
  try {
    switch (message.type) {
      case 'ready': {
        // The robot fields as the message has them, whatever they are: the bridge refuses a ready the host would drop
        const robot = Object.fromEntries(READY_FIELDS.filter((field) => field in message).map((field) => [field, message[field]]));
        bridge.ready({
          template: message.template as string,
          profile: message.profile as string | null,
          goals: message.goals as { id: string; label: string }[],
          ...(Object.keys(robot).length === 0 ? {} : { robot: robot as unknown as RobotReady }),
        });
        break;
      }
      case 'run-started':
        bridge.runStarted();
        break;
      case 'run-stopped':
        bridge.runStopped();
        break;
      case 'project-changed':
        bridge.projectChanged(message.document as ProjectDocument);
        bridge.flush();
        break;
      case 'check-result':
        if (lab !== undefined) {
          bridge.ready({ template: 'rb-stop-at-wall', profile: 'uno-basic', goals: announcedGoals(message) });
          posted.length = 0;
        }
        // A Blockly or Yolo:Bit lab has only the plain check-result, whatever its message carries
        if (lab !== undefined && hasRobotFields(message)) {
          bridge.robotCheckResult(checkInputOf(message));
        } else {
          bridge.checkResult({ passed: message.passed as boolean, goals: message.goals as { id: string; label: string; passed: boolean }[] });
        }
        break;
      default:
        throw new Error(`The fixture has a message of type ${String(message.type)}, which this test does not drive.`);
    }
    return { posted, error: undefined };
  } catch (error) {
    return { posted, error };
  }
}

describe('the shared robot fixture file', () => {
  it('is byte-identical to the one STEMLearning tests the host parser with (sha256 and size)', () => {
    expect(bytes.length).toBe(FIXTURE_BYTES);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(FIXTURE_SHA256);
  });

  it('is of stem-lab/v1, version 1, and states the bounds the bridge holds its messages to', () => {
    expect(fixture.protocol).toBe(LAB_PROTOCOL);
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.bounds).toEqual({
      lab: ROBOT_LAB,
      maxScore: ROBOT_CHECK_LIMITS.maxScore,
      maxVariants: ROBOT_CHECK_LIMITS.maxVariants,
      simTimeMsMax: ROBOT_CHECK_LIMITS.simTimeMsMax,
      engine: ROBOT_CHECK_LIMITS.engine.source,
      programHash: ROBOT_CHECK_LIMITS.programHash.source,
      scenarioVersionMin: ROBOT_CHECK_LIMITS.scenarioVersionMin,
      scenarioVersionMax: ROBOT_CHECK_LIMITS.scenarioVersionMax,
      maxGoals: ROBOT_CHECK_LIMITS.maxGoals,
      maxGoalText: ROBOT_CHECK_LIMITS.maxGoalText,
    });
  });

  it('names every case once', () => {
    const names = [...fixture.valid, ...fixture.invalid, ...fixture.nonFinite, ...fixture.incomplete, ...fixture.notRobot].map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(fixture.valid.length).toBe(15);
    expect(fixture.invalid.length).toBe(50);
  });
});

// The host reads these. Every one the lab can send, the bridge sends byte for byte (key order included).
describe('the messages of the robot lab against the fixture’s valid ones', () => {
  /** Valid for the host's parser, but not something the lab sends: the scored check-result of the fixture that leaves out what the lab always reports. */
  const parserOnly = ['check-result without the optional simTimeMs, variants and programHash'];
  const sendable = fixture.valid.filter((entry) => !parserOnly.includes(entry.name));

  it('has every valid message sendable by the bridge but the one that leaves out simTimeMs, variants and programHash', () => {
    expect(fixture.valid.map((entry) => entry.name).filter((name) => parserOnly.includes(name))).toEqual(parserOnly);
    expect(sendable).toHaveLength(14);
  });

  it.each(sendable.map((entry) => [entry.name, entry.message] as const))('builds %s, byte for byte', (_, message) => {
    const { posted, error } = send(message, ROBOT_LAB);
    expect(error).toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted[0])).toBe(JSON.stringify(documentedPart(message)));
    expect(posted[0]?.lab).toBe(ROBOT_LAB);
  });

  it('drops only fields the host ignores, and only from the one message that carries them', () => {
    const changed = sendable.filter((entry) => JSON.stringify(documentedPart(entry.message)) !== JSON.stringify(entry.message)).map((entry) => entry.name);
    expect(changed).toEqual(['check-result with fields the host does not know (ignored)']);
  });

  it('sends the same bytes through JSON as it posts: no undefined, no null, no field the fixture does not list', () => {
    for (const { message } of sendable) {
      const { posted } = send(message, ROBOT_LAB);
      expect(JSON.parse(JSON.stringify(posted[0]))).toEqual(posted[0]);
      expect(JSON.stringify(posted[0])).not.toContain('null');
    }
  });

  it('refuses the valid message that leaves out what a scored check always reports, naming what is missing', () => {
    const { posted, error } = send(validMessage(parserOnly[0]!), ROBOT_LAB);
    expect(error).toBeInstanceOf(RobotMessageError);
    const problems = (error as RobotMessageError).problems.map((problem) => problem.split(':')[0]);
    expect(problems).toEqual(['simTimeMs', 'variants', 'programHash']);
    expect(posted).toEqual([]);
  });
});

// The host drops these; so the bridge never builds them. Each is refused for the field the fixture says is wrong.
describe('the messages of the robot lab against the fixture’s refused ones', () => {
  const readyBase = validMessage('ready of a scenario');
  const checkBase = validMessage('check-result of a passing check over three variants');
  const baseOf = (message: Message) => (message.type === 'ready' ? readyBase : checkBase);

  /** The top-level fields in which a message differs from its valid base: the ones its refusal must be about. */
  function differingFields(message: Message, base: Message): string[] {
    return [...new Set([...Object.keys(message), ...Object.keys(base)])].filter((key) => JSON.stringify(message[key]) !== JSON.stringify(base[key]));
  }

  function expectRefused(message: Message, reason: string) {
    const { posted, error } = send(message, ROBOT_LAB);
    expect(error, reason).toBeInstanceOf(RobotMessageError);
    expect(posted, reason).toEqual([]);
    const fields = differingFields(message, baseOf(message));
    expect(fields.length, 'a refused message differs from its valid base').toBeGreaterThan(0);
    const problems = (error as RobotMessageError).problems;
    expect(problems.some((problem) => fields.some((field) => problem.startsWith(field))), `${reason}: ${problems.join('; ')} (differs in ${fields.join(', ')})`).toBe(true);
  }

  it.each(fixture.invalid.map((entry) => [entry.name, entry.reason, entry.message] as const))('refuses to build %s (%s)', (_, reason, message) => {
    expectRefused(message, reason);
  });

  it.each(fixture.nonFinite.map((entry) => [entry.name, entry] as const))('refuses to build %s', (_, entry) => {
    const base = validMessage(entry.base);
    expect(send(base, ROBOT_LAB).error).toBeUndefined();
    const message = withField(base, entry.path, Number(entry.value));
    const { posted, error } = send(message, ROBOT_LAB);
    expect(error, entry.reason).toBeInstanceOf(RobotMessageError);
    expect(posted).toEqual([]);
    expect((error as RobotMessageError).problems.some((problem) => problem.startsWith(String(entry.path[0])))).toBe(true);
  });

  it.each(fixture.incomplete.map((entry) => [entry.name, entry.reason, entry.message] as const))('refuses to build %s (%s): a scenario with goals reports its score', (_, reason, message) => {
    const { posted, error } = send(message, ROBOT_LAB);
    expect(error, reason).toBeInstanceOf(RobotMessageError);
    expect(posted).toEqual([]);
  });
});

// A Blockly or Yolo:Bit lab says no `lab` and no robot field, whatever it is asked: the fixture's notRobot messages, less their robot fields.
describe('the messages of a Blockly or Yolo:Bit lab against the fixture’s notRobot ones', () => {
  it.each(fixture.notRobot.map((entry) => [entry.name, entry.note, entry.message] as const))('builds %s without any robot field, and with the bytes it always had', (_, __, message) => {
    const plain = Object.fromEntries(Object.entries(message).filter(([name]) => !ROBOT_FIELDS.has(name)));
    const { posted, error } = send(message);
    expect(error).toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(JSON.stringify(posted[0])).toBe(JSON.stringify(plain));
    expect(Object.keys(posted[0] ?? {}).filter((name) => ROBOT_FIELDS.has(name))).toEqual([]);
  });

  it('never sends a robot check-result: that is the robot lab’s', () => {
    const { bridge, posted } = setup();
    const message = validMessage('check-result of a passing check over three variants');
    expect(() => bridge.robotCheckResult(checkInputOf(message))).toThrow(RobotMessageError);
    expect(posted).toEqual([]);
  });
});

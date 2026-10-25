import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../src/core/circuit/document';
import { generateUnoSketch } from '../src/core/codegen/arduino/generate';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { checkKit, kitBoardTarget, kitRefOf, productionKits, referenceKitRef, unoR3Board, type Kit, type KitRef, type KitUsage } from '../src/core/hardware';
import { rehearsalKit, rehearsalKitRef, rehearsalKits } from '../src/core/hardware/rehearsal-kits';
import { productionProfiles } from '../src/core/profiles';
import { createBlockPackCatalog } from '../src/core/program/block-packs';
import { compileUnoProject } from '../src/core/program/compile-uno-program';
import { checkRobot, type CheckProgress } from '../src/core/scenario/check-robot';
import type { Scenario } from '../src/core/scenario/scenario';
import { initPhysics } from '../src/core/world/rapier';
import { hashSnapshot } from '../src/core/world/snapshot';
import { scenarioCatalog } from '../src/samples/robot-scenarios';
import { robotSolutions, type RobotScoredKey } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import { compileFixture, parityFixtures, rehearsalParityFixtures, sketchOf, type ParityFixture } from './parity/fixtures';
import { allowedDifferences } from './parity/allowed-differences';
import { runBoard } from './parity/board-run';
import { runParity } from './parity/harness';

// N18 R8a, the kit-swap rehearsal (docs/kit-swap-rehearsal.md): rehearsal-rover@0 plays a kit "from another vendor", made as data only
// (src/core/hardware/kits/rehearsal.kit.json): ref-uno-rover@0's robot with every port on other pins, the line sensors active-low and the
// left motor's IN1/IN2 the other way round. Nothing of the engine changes. With it swapped in: the pin rules, the board target, the six
// pilot reference solutions through the real check (the same scores), the C1 sketches (only the pins, the line polarity and the IN order
// change; they are goldens here, and `pnpm check:arduino` compiles them, L2) and the C2 parity of the driver fixtures on avr8js.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const reference = productionKits.get(referenceKitRef) as Kit;
const pilots = Object.keys(robotSolutions) as RobotScoredKey[];

describe('rehearsal-rover@0: another vendor’s kit as data only', () => {
  it('is registered as a production kit is (createKitCatalog), apart from the product kits, and a document names it', () => {
    expect(rehearsalKits.refs()).toEqual([referenceKitRef, rehearsalKitRef]);
    expect(rehearsalKits.boardOf(rehearsalKitRef)).toBe(unoR3Board);
    expect(rehearsalKit).toMatchObject({ id: 'rehearsal-rover', version: '0', board: 'uno-r3' });
    expect(productionKits.get(rehearsalKitRef)).toBeUndefined();
    const document: ProjectDocument = { ...robotStarterDocument('rb-drive-to-zone'), kit: { ...rehearsalKitRef } };
    expect(rehearsalKits.get(kitRefOf(document))).toBe(rehearsalKit);
    const compiled = compileUnoProject({ ...document, program: { blocks: structuredClone(robotSolutions['rb-drive-to-zone'].reference) } }, { registry, profiles: productionProfiles, packs, kits: rehearsalKits });
    expect(compiled.ok && compiled.kit).toBe(rehearsalKit);
  });

  it('is the reference robot: the same chassis, modules (roles, ports, mounts, specs) and ports (ids, drivers, order)', () => {
    expect(rehearsalKit.chassis).toEqual(reference.chassis);
    expect(rehearsalKit.modules).toEqual(reference.modules);
    expect(rehearsalKit.ports.map((port) => [port.id, port.driver])).toEqual(reference.ports.map((port) => [port.id, port.driver]));
  });

  it('wires every port pin elsewhere, the line sensors active-low, the left motor’s IN1/IN2 the other way round', () => {
    const wiring = (kit: Kit) => Object.fromEntries(kit.ports.map((port) => [port.id, { ...port.pins, ...port.params }]));
    expect(wiring(rehearsalKit)).toEqual({
      M1: { EN: 'D6', IN1: 'D2', IN2: 'D4' },
      M2: { EN: 'D5', IN1: 'D7', IN2: 'D8' },
      US1: { TRIG: 'D11', ECHO: 'D12' },
      LN1: { PIN: 'A3', activeLow: true },
      LN2: { PIN: 'A2', activeLow: true },
      LN3: { PIN: 'A1', activeLow: true },
      LED1: { PIN: 'D9' },
      BTN1: { PIN: 'D13' },
      SV1: { PIN: 'D10' },
      BZ1: { PIN: 'D3' },
    });
    for (const port of reference.ports) {
      const other = rehearsalKit.ports.find((candidate) => candidate.id === port.id)!;
      for (const [name, pin] of Object.entries(port.pins)) expect(other.pins[name], `${port.id}.${name}`).not.toBe(pin);
    }
    // The left motor sits on the right motor's old pins, IN1 and IN2 swapped (the driver has no invert param).
    expect(reference.ports.find((port) => port.id === 'M2')!.pins).toEqual({ EN: 'D6', IN1: 'D4', IN2: 'D2' });
  });

  it('has no checkKit diagnostic for any use of the servo (T1), the tone (T2) and Serial (D0, D1)', () => {
    const usages: KitUsage[] = [false, true].flatMap((servo) => [false, true].flatMap((tone) => [false, true].map((serial) => ({ servo, tone, serial }))));
    expect(usages).toHaveLength(8);
    for (const usage of usages) expect(checkKit(rehearsalKit, unoR3Board, usage), JSON.stringify(usage)).toEqual([]);
  });

  it('gives the same roles and module ops as the reference kit (kitBoardTarget)', () => {
    const rehearsal = kitBoardTarget(rehearsalKit, unoR3Board);
    const target = kitBoardTarget(reference, unoR3Board);
    expect(rehearsal.roles).toEqual(['motorLeft', 'motorRight', 'ultrasonic', 'lineLeft', 'lineCenter', 'lineRight', 'servo1', 'led1', 'buzzer', 'button1']);
    expect(rehearsal.roles).toEqual(target.roles);
    expect(rehearsal.ops).toEqual(target.ops);
    expect(rehearsal.claimers).toEqual(target.claimers);
    expect(rehearsal.kit).toEqual(rehearsalKitRef);
  });
});

/** A pilot's reference solution in its starter document on `kitRef`. */
const pilotProject = (key: RobotScoredKey, kitRef: KitRef): ProjectDocument => ({
  ...robotStarterDocument(key),
  kit: { ...kitRef },
  program: { blocks: structuredClone(robotSolutions[key].reference) },
});

describe('the six pilot reference solutions through the real check, headless, with the rehearsal kit swapped in', () => {
  beforeAll(() => initPhysics(), 30_000);

  /** The check of the reference on `kit` (the scenario run on that kit, the document naming it), and each variant's end and last world. */
  async function outcomeOn(key: RobotScoredKey, kit: Kit) {
    const ended: unknown[] = [];
    // The scenario schema ties each robot key to robotKitId (robot-keys.ts), so a scenario JSON cannot name the rehearsal kit: the loaded
    // scenario takes it here, as a vendor kit would take robotKitId's place (docs/kit-swap-rehearsal.md).
    const scenario: Scenario = { ...scenarioCatalog.get(key)!, kit: kit.id };
    const result = await checkRobot(pilotProject(key, kit), scenario, {
      mode: 'headless',
      kit,
      board: unoR3Board,
      registry,
      onProgress: (progress: CheckProgress) => {
        if (progress.kind !== 'variant-ended') return;
        // The world without the virtual UNO's pins, which name the kit's pins: the robot, the objects, the sensors, the LEDs, the score.
        const world = progress.snapshot.world!;
        ended.push({ goals: progress.goals, end: progress.end, error: progress.error, world: hashSnapshot({ ...world, pins: [] }) });
      },
    }).result;
    return { result, variants: ended };
  }

  it.each(pilots)('%s: passes with the same result, goals, ends and worlds as with the reference kit', async (key) => {
    const [onReference, onRehearsal] = [await outcomeOn(key, reference), await outcomeOn(key, rehearsalKit)];
    expect(onRehearsal.result).not.toBeNull();
    expect(onRehearsal.result!.passed).toBe(true);
    expect(onRehearsal).toEqual(onReference);
  }, 300_000);
});

// --- C1: the sketches -------------------------------------------------------------------------------------------------------------

/** The sketch of a pilot's reference solution on `kitRef`, as tests/robot-scenarios.test.ts writes the reference kit's. */
function pilotSketch(key: RobotScoredKey, kitRef: KitRef): string {
  const compiled = compileUnoProject(pilotProject(key, kitRef), { registry, profiles: productionProfiles, packs, kits: rehearsalKits });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const sketch = generateUnoSketch(compiled.ir, { kit: compiled.kit, board: compiled.board, scenario: { key, version: scenarioCatalog.get(key)!.version } });
  if (!sketch.ok) throw new Error(JSON.stringify(sketch.diagnostics));
  return sketch.source;
}

/** The #define lines of the rehearsal kit's pins, by module, as [name, reference pin, rehearsal pin]. */
const defines = {
  motors: [
    ['MOTOR_LEFT_EN', '5', '6'],
    ['MOTOR_LEFT_IN1', '7', '2'],
    ['MOTOR_LEFT_IN2', '8', '4'],
    ['MOTOR_RIGHT_EN', '6', '5'],
    ['MOTOR_RIGHT_IN1', '4', '7'],
    ['MOTOR_RIGHT_IN2', '2', '8'],
  ],
  ultrasonic: [
    ['ULTRASONIC_TRIG', '12', '11'],
    ['ULTRASONIC_ECHO', '11', '12'],
  ],
  lines: [
    ['LINE_LEFT_PIN', 'A0', 'A3'],
    ['LINE_CENTER_PIN', 'A1', 'A2'],
    ['LINE_RIGHT_PIN', 'A2', 'A1'],
  ],
  servo: [['SERVO1_PIN', '9', '10']],
} as const;

/** What changes in each pilot's sketch: the modules whose pins it defines, and the line reads whose dark level flips (HIGH → LOW). */
const changes: Readonly<Record<RobotScoredKey, { modules: readonly (keyof typeof defines)[]; lineReads: readonly string[] }>> = {
  'rb-drive-to-zone': { modules: ['motors'], lineReads: [] },
  'rb-square-route': { modules: ['motors'], lineReads: [] },
  'rb-stop-at-wall': { modules: ['motors', 'ultrasonic'], lineReads: [] },
  'rb-line-follow': { modules: ['motors', 'lines'], lineReads: ['CENTER', 'LEFT', 'RIGHT'] },
  'rb-servo-gate': { modules: ['motors', 'ultrasonic', 'servo'], lineReads: [] },
  'rb-mini-mission': { modules: ['motors', 'ultrasonic', 'lines'], lineReads: ['CENTER', 'LEFT', 'RIGHT'] },
};

describe('the C1 sketches of the pilot references on the rehearsal kit (goldens, compiled by pnpm check:arduino: L2)', () => {
  it.each(pilots)('%s: differs from the reference kit’s only in the header’s kit, the pin #defines and the line polarity', (key) => {
    const before = pilotSketch(key, referenceKitRef).split('\n');
    const after = pilotSketch(key, rehearsalKitRef).split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [[line, after[index]]]));
    const version = scenarioCatalog.get(key)!.version;
    expect(changed).toEqual([
      [`// Scenario: ${key}@${version}, kit: ref-uno-rover@0, board: uno-r3@0`, `// Scenario: ${key}@${version}, kit: rehearsal-rover@0, board: uno-r3@0`],
      ...changes[key].modules.flatMap((module) => defines[module].map(([name, from, to]) => [`#define ${name} ${from}`, `#define ${name} ${to}`])),
      ...changes[key].lineReads.map((role) => [expect.stringContaining(`(digitalRead(LINE_${role}_PIN) == HIGH)`), expect.stringContaining(`(digitalRead(LINE_${role}_PIN) == LOW)`)]),
    ]);
    // A flipped line read is the same line, but for its level.
    for (const [from, to] of changed.slice(1).filter(([from]) => from!.includes('digitalRead(LINE_'))) expect(to).toBe(from!.replace('== HIGH)', '== LOW)'));
  });

  it.each(pilots)('%s: the rehearsal sketch is its golden tests/kit-rehearsal/rehearsal-%s.ino', async (key) => {
    const sketch = pilotSketch(key, rehearsalKitRef);
    expect(sketch.split('\n')[0]).toBe(`// Scenario: ${key}@1, kit: rehearsal-rover@0, board: uno-r3@0`);
    await expect(sketch).toMatchFileSnapshot(`./kit-rehearsal/rehearsal-${key}.ino`);
  });

  it('has a golden for every pilot reference, and nothing else', () => {
    expect(readdirSync(new URL('./kit-rehearsal/', import.meta.url)).sort()).toEqual(pilots.map((key) => `rehearsal-${key}.ino`).sort());
  });
});

// --- C2: the avr8js parity of the driver fixtures --------------------------------------------------------------------------------

const rehearsalDir = new URL('./__parity-rehearsal__/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, rehearsalDir), 'utf8');
const referenceHex = (name: string) => readFileSync(new URL(`./__parity__/${name}.hex`, import.meta.url), 'utf8');
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const referenceOf = (fixture: ParityFixture) => parityFixtures.find((candidate) => `rehearsal-${candidate.name}` === fixture.name)!;

describe('the C2 parity harness with the rehearsal kit (tests/__parity-rehearsal__, pnpm build:parity-hex --rehearsal)', () => {
  it('runs every driver fixture of the reference kit on rehearsal-rover@0, motor, line and ultrasonic among them', () => {
    expect(rehearsalParityFixtures.map((fixture) => fixture.name)).toEqual([
      'rehearsal-driver-motor',
      'rehearsal-driver-servo',
      'rehearsal-driver-ultrasonic',
      'rehearsal-driver-line',
      'rehearsal-driver-led',
      'rehearsal-driver-button',
      'rehearsal-driver-buzzer',
    ]);
    for (const fixture of rehearsalParityFixtures) {
      expect(fixture.kit).toEqual(rehearsalKitRef);
      expect(compileFixture(fixture).kit).toBe(rehearsalKit);
      expect({ ...fixture, name: referenceOf(fixture).name, kit: undefined, inputs: undefined }).toEqual({ ...referenceOf(fixture), kit: undefined, inputs: undefined });
    }
  });

  it('gives each fixture its inputs on the rehearsal pins, the line levels flipped for its active-low sensors', () => {
    const inputsOf = (name: string) => rehearsalParityFixtures.find((fixture) => fixture.name === `rehearsal-${name}`)!.inputs;
    expect(inputsOf('driver-line')).toEqual({
      levels: [
        { pin: 'A3', atUs: 0, level: 1 },
        { pin: 'A2', atUs: 0, level: 1 },
        { pin: 'A1', atUs: 0, level: 1 },
        { pin: 'A3', atUs: 0, level: 1 },
        { pin: 'A2', atUs: 0, level: 0 },
        { pin: 'A3', atUs: 10_000, level: 0 },
        { pin: 'A2', atUs: 10_000, level: 1 },
        { pin: 'A1', atUs: 10_000, level: 0 },
      ],
      analog: [{ pins: ['A3', 'A2', 'A1'], values: [0, 512, 1023] }],
    });
    expect(inputsOf('driver-ultrasonic').echoes).toMatchObject({ trig: 'D11', echo: 'D12' });
    expect(inputsOf('driver-button').levels).toEqual([
      { pin: 'D13', atUs: 15_000, level: 0 },
      { pin: 'D13', atUs: 35_000, level: 1 },
    ]);
  });

  it('has a HEX and the hash of its sketch for every rehearsal fixture, and nothing else, built with the pinned toolchain', () => {
    const expected = [...rehearsalParityFixtures.flatMap((fixture) => [`${fixture.name}.hex`, `${fixture.name}.ino.sha256`]), 'toolchain.json'].sort();
    expect(readdirSync(rehearsalDir).sort()).toEqual(expected);
    const toolchain = JSON.parse(read('toolchain.json')) as { fqbn: string; arduinoCli: string; core: string; libraries: string[]; sketches: Record<string, { hexSha256: string }> };
    expect(toolchain).toMatchObject({ fqbn: 'arduino:avr:uno', arduinoCli: '1.5.1', core: 'arduino:avr@1.8.8', libraries: ['Servo@1.3.0'] });
    for (const fixture of rehearsalParityFixtures) {
      expect(sha256(read(`${fixture.name}.hex`)), fixture.name).toBe(toolchain.sketches[fixture.name]?.hexSha256);
      expect(read(`${fixture.name}.ino.sha256`), `${fixture.name}: run pnpm build:parity-hex --rehearsal`).toBe(`${sha256(sketchOf(fixture))}  ${fixture.name}.ino\n`);
    }
  });

  /** Each kit pin's states in order (the simulator's, exact), on the rehearsal kit's pins: a reference pin is read through its port. */
  const pinOf = new Map(reference.ports.flatMap((port) => Object.entries(port.pins).map(([name, pin]) => [pin, rehearsalKit.ports.find((other) => other.id === port.id)!.pins[name]!] as const)));
  const statesByPin = (events: readonly { pin: string; state: unknown }[], kit: Kit, map: (pin: string) => string) => {
    const pins = new Set(kit.ports.flatMap((port) => Object.values(port.pins)));
    const byPin = new Map<string, unknown[]>();
    for (const event of events.filter((candidate) => pins.has(candidate.pin))) byPin.set(map(event.pin), [...(byPin.get(map(event.pin)) ?? []), event.state]);
    return [...byPin.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  };

  it.each(rehearsalParityFixtures)('$name: the simulator and the board run it the same, and do what they do on the reference kit', async (fixture) => {
    const run = await runParity(fixture, read(`${fixture.name}.hex`));
    expect(run.comparison.problems).toEqual([]);
    expect(run.sim.outcome).toEqual({ status: fixture.forever ? 'stopped' : 'finished' });
    const onReference = await runParity(referenceOf(fixture), referenceHex(referenceOf(fixture).name));
    expect(run.board.lines.map((line) => line.text)).toEqual(onReference.board.lines.map((line) => line.text));
    expect(run.sim.lines.map((line) => line.text)).toEqual(onReference.sim.lines.map((line) => line.text));
    const states = statesByPin(run.sim.events, rehearsalKit, (pin) => pin);
    expect(states.length).toBeGreaterThan(0);
    expect(states).toEqual(statesByPin(onReference.sim.events, reference, (pin) => pinOf.get(pin) ?? pin));
  }, 120_000);

  // The rehearsal's finding (docs/kit-swap-rehearsal.md §4.2, controller ruling): on D10 Servo 1.3.0's first pulse after attach() is
  // 4.5625 µs longer than the next (3.5625 on D9), over waveform-jitter's 4 µs for steady pulses; servo-first-pulse allows that first pulse
  // 6 µs (firstWidthUs), so the fixture above matches.
  it('rehearsal-driver-servo needs servo-first-pulse’s 6 µs: its first pulse after attach() on D10 is 4.5625 µs longer than the next', () => {
    const fixture = rehearsalParityFixtures.find((candidate) => candidate.name === 'rehearsal-driver-servo')!;
    const widthsOf = (candidate: ParityFixture, hex: string, pin: string) => {
      const program = compileFixture(candidate);
      const edges = runBoard(hex, { kit: program.kit, board: program.board, decodings: new Map() }, candidate.inputs, 130_000).events.filter((event) => event.pin === pin);
      return edges.flatMap((edge, index) => (edge.state.kind === 'high' && edges[index + 1]?.state.kind === 'low' ? [edges[index + 1]!.fromUs - edge.fromUs] : []));
    };
    const onD10 = widthsOf(fixture, read(`${fixture.name}.hex`), 'D10');
    const onD9 = widthsOf(referenceOf(fixture), referenceHex('driver-servo'), 'D9');
    const degrees = (widthUs: number) => Math.round(((widthUs - 544) * 180) / 1856);
    expect(onD10.map(degrees)).toEqual([90, 90, 45, 45]);
    expect(onD9.map(degrees)).toEqual([90, 90, 45, 45]);
    expect(allowedDifferences['waveform-jitter'].servo.highUs).toBe(4);
    expect(allowedDifferences['servo-first-pulse'].firstWidthUs).toBe(6);
    expect(onD10[0]! - onD10[1]!).toBeCloseTo(4.5625, 9);
    expect(onD9[0]! - onD9[1]!).toBeCloseTo(3.5625, 9);
  }, 120_000);
});
